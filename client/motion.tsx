/**
 * Motion primitives (Phase 4 polish).
 *
 * ONE authored moment, not a scatter of effects: a new turn of conversation
 * arriving, and a finding resolving into view. Everything else holds still,
 * because this is a tool someone reads mid-crisis and motion that competes
 * with a finding is motion that hides it.
 *
 * `reducedMotion="user"` is set once at the root. Motion then drops transform
 * and layout animations for anyone whose OS asks for reduced motion, on top of
 * the CSS-level kill in styles.css. Two layers, because one can be bypassed.
 */
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

const EASE = [0.16, 1, 0.3, 1] as const;

/** The arrival. Springs in from below, settles fast, never bounces. */
export function Turn({ children, index }: { children: ReactNode; index: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.article
      initial={reduced ? false : { opacity: 0, y: 14, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{
        duration: reduced ? 0 : 0.42,
        ease: EASE,
        // Only the newest turn animates in; replaying the whole log on every
        // render would be noise.
        delay: reduced ? 0 : Math.min(index, 1) * 0.04,
      }}
    >
      {children}
    </motion.article>
  );
}

/** Findings resolve one after another so the eye follows severity order. */
export function StaggeredList({ children, count }: { children: ReactNode; count: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.ol
      initial="hidden"
      animate="shown"
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: reduced ? 0 : 0.055 } },
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <motion.li
          key={i}
          variants={{
            hidden: reduced ? {} : { opacity: 0, y: 10 },
            shown: { opacity: 1, y: 0, transition: { duration: 0.34, ease: EASE } },
          }}
        >
          {Array.isArray(children) ? children[i] : null}
        </motion.li>
      ))}
    </motion.ol>
  );
}

/** The evidence drawer: height and opacity, so nothing jumps. */
export function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="panel"
          initial={reduced ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={reduced ? undefined : { height: 0, opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.28, ease: EASE }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Persona changes are a state swap; a crossfade keeps it from flickering. */
export function Crossfade({ value, children }: { value: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      key={value}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0 : 0.18 }}
    >
      {children}
    </motion.span>
  );
}