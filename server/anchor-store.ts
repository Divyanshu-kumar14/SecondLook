/**
 * S3 implementation of the audit-anchor store.
 *
 * Kept separate from `anchor.ts` so the tests can exercise the manifest and
 * verification logic without an AWS client, and so the base server never loads
 * the S3 SDK unless somebody runs `npm run anchor`.
 */
import {
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  GetObjectRetentionCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type {
  AnchorObjectRetention,
  AnchorRetentionMode,
  AnchorStore,
  GetAnchorObjectInput,
  GetAnchorObjectResult,
  PutAnchorObjectInput,
  PutAnchorObjectResult,
} from './anchor.js';

/** Minimal sender surface; tests inject a fake instead of mocking the SDK. */
export type AnchorSend = (command: unknown) => Promise<unknown>;

export interface S3AnchorStoreOptions {
  bucket: string;
  region: string;
  /** Test seam. Production leaves this unset and creates a real S3Client. */
  send?: AnchorSend;
}

function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    return String(error.name);
  }
  return 'S3Error';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wrapS3Error(error: unknown, bucket: string): Error {
  const name = errorName(error);
  if (name === 'NoSuchBucket') {
    return new Error(
      `S3 bucket "${bucket}" does not exist. Create it with Object Lock enabled; ` +
        'see the README section "AWS integration: S3 Object Lock audit anchor".',
    );
  }
  if (name === 'ObjectLockConfigurationNotFoundError') {
    return new Error(
      `S3 bucket "${bucket}" has no Object Lock configuration. Object Lock can only be ` +
        'enabled when the bucket is created; see the README for the one-time command.',
    );
  }
  if (name === 'AccessDenied' || name === 'AccessDeniedException') {
    return new Error(
      `Access denied for S3 bucket "${bucket}". The identity running the anchor needs ` +
        's3:GetBucketVersioning, s3:GetBucketObjectLockConfiguration, s3:PutObject, ' +
        's3:PutObjectRetention, s3:GetObject, s3:GetObjectVersion and s3:GetObjectRetention.',
    );
  }
  return new Error(`S3 request failed for bucket "${bucket}": ${name}: ${errorMessage(error)}`);
}

export class S3AnchorStore implements AnchorStore {
  readonly bucket: string;
  readonly region: string;
  readonly #send: AnchorSend;

  constructor(options: S3AnchorStoreOptions) {
    const bucket = options.bucket.trim();
    const region = options.region.trim();
    if (bucket === '') throw new Error('S3 anchor bucket is required.');
    if (region === '') throw new Error('S3 anchor region is required.');
    this.bucket = bucket;
    this.region = region;

    if (options.send !== undefined) {
      this.#send = options.send;
    } else {
      const client = new S3Client({ region });
      this.#send = (command) => client.send(command as Parameters<S3Client['send']>[0]);
    }
  }

  async assertObjectLock(): Promise<void> {
    let versioning: unknown;
    try {
      versioning = await this.#send(new GetBucketVersioningCommand({ Bucket: this.bucket }));
    } catch (error) {
      throw wrapS3Error(error, this.bucket);
    }
    const status = (versioning as { Status?: string }).Status;
    if (status !== 'Enabled') {
      throw new Error(
        `S3 bucket "${this.bucket}" is not versioned. Object Lock requires bucket versioning; ` +
          'recreate the bucket with Object Lock enabled.',
      );
    }

    let lock: unknown;
    try {
      lock = await this.#send(
        new GetObjectLockConfigurationCommand({ Bucket: this.bucket }),
      );
    } catch (error) {
      throw wrapS3Error(error, this.bucket);
    }
    const configuration = (lock as {
      ObjectLockConfiguration?: { ObjectLockEnabled?: string };
    }).ObjectLockConfiguration;
    if (configuration?.ObjectLockEnabled !== 'Enabled') {
      throw new Error(
        `S3 bucket "${this.bucket}" does not have Object Lock enabled. Object Lock can only ` +
          'be enabled when the bucket is created; see the README for the one-time command.',
      );
    }
  }

  async putObject(input: PutAnchorObjectInput): Promise<PutAnchorObjectResult> {
    let result: unknown;
    try {
      result = await this.#send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          ServerSideEncryption: 'AES256',
          ObjectLockMode: input.retention.mode,
          ObjectLockRetainUntilDate: new Date(input.retention.until),
          ...(input.metadata === undefined ? {} : { Metadata: input.metadata }),
        }),
      );
    } catch (error) {
      throw wrapS3Error(error, this.bucket);
    }

    const output = result as { VersionId?: string; ETag?: string };
    if (output.VersionId === undefined || output.VersionId === '') {
      throw new Error(
        `S3 did not return a version id for ${input.key}. Is bucket versioning enabled?`,
      );
    }
    return {
      versionId: output.VersionId,
      ...(output.ETag === undefined ? {} : { etag: output.ETag }),
    };
  }

  async getObject(input: GetAnchorObjectInput): Promise<GetAnchorObjectResult> {
    let result: unknown;
    try {
      result = await this.#send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          ...(input.versionId === undefined ? {} : { VersionId: input.versionId }),
        }),
      );
    } catch (error) {
      throw wrapS3Error(error, this.bucket);
    }

    const output = result as {
      Body?: { transformToByteArray?: () => Promise<Uint8Array> };
      VersionId?: string;
      ETag?: string;
      ContentType?: string;
    };
    const body = output.Body;
    if (body === undefined || typeof body.transformToByteArray !== 'function') {
      throw new Error(`S3 returned no body for ${input.key}.`);
    }
    const bytes = await body.transformToByteArray();
    return {
      body: bytes,
      ...(output.VersionId === undefined ? {} : { versionId: output.VersionId }),
      ...(output.ETag === undefined ? {} : { etag: output.ETag }),
      ...(output.ContentType === undefined ? {} : { contentType: output.ContentType }),
    };
  }

  async getObjectRetention(
    input: GetAnchorObjectInput,
  ): Promise<AnchorObjectRetention> {
    let result: unknown;
    try {
      result = await this.#send(
        new GetObjectRetentionCommand({
          Bucket: this.bucket,
          Key: input.key,
          ...(input.versionId === undefined ? {} : { VersionId: input.versionId }),
        }),
      );
    } catch (error) {
      throw wrapS3Error(error, this.bucket);
    }

    const output = result as {
      Retention?: { Mode?: string; RetainUntilDate?: Date };
    };
    const retention = output.Retention;
    if (retention === undefined) {
      throw new Error(`S3 returned no Object Lock retention for ${input.key}.`);
    }
    const mode = retention.Mode;
    if (mode !== 'GOVERNANCE' && mode !== 'COMPLIANCE') {
      throw new Error(`S3 returned no Object Lock retention mode for ${input.key}.`);
    }
    if (!(retention.RetainUntilDate instanceof Date)) {
      throw new Error(`S3 returned no retention date for ${input.key}.`);
    }
    const typedMode: AnchorRetentionMode = mode;
    return { mode: typedMode, until: retention.RetainUntilDate.toISOString() };
  }
}
