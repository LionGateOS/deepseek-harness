/** Durable per-Team orchestration mode: how strongly the Lead should delegate to specialists. */

import { z as zod } from 'zod'
import { appendPluginRecord, pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/** How strongly the Team Lead should delegate work to catalog specialists. */
export type OrchestrationMode = 'off' | 'auto' | 'on'

/** Every selectable mode, in increasing delegation preference. */
export const ORCHESTRATION_MODES: readonly OrchestrationMode[] = ['off', 'auto', 'on']

/** Mode a Team uses until the owner selects another one. */
export const DEFAULT_ORCHESTRATION_MODE: OrchestrationMode = 'auto'

/** Durable record type that carries one whole-mode selection. */
export const ORCHESTRATION_MODE_RECORD = 'plugin:tool-agent-team/orchestration-mode'

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Owner-selected orchestration mode, appended once per mode change. */
    'plugin:tool-agent-team/orchestration-mode': {
      /** Complete post-change mode; the last record in the log wins. */
      mode: OrchestrationMode
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Owner-selected orchestration mode, folded from its durable records. */
    toolAgentTeamOrchestrationMode: OrchestrationMode
  }
}

const orchestrationModeSchema: zod.ZodType<OrchestrationMode> = zod.enum(['off', 'auto', 'on'])

const orchestrationModeRecordSchema = zod.object({ mode: orchestrationModeSchema }).strict()

/** Host-only projection of the durable orchestration mode. */
export const orchestrationModeProjectionDefinition = {
  key: 'toolAgentTeamOrchestrationMode',
  stateVersion: 1,
  stateSchema: orchestrationModeSchema,
  init: () => DEFAULT_ORCHESTRATION_MODE,
  apply: (mode, event) => {
    const record = pluginRecordOf(event)
    if (record?.type !== ORCHESTRATION_MODE_RECORD) return mode
    return orchestrationModeRecordSchema.parse(record.data).mode
  },
} satisfies ProjectionDefinition<'toolAgentTeamOrchestrationMode', OrchestrationMode>

/**
 * Read the mode a Team's durable log currently selects.
 * @param projections - registry that owns the mode projection.
 * @param session - Team log whose selection is read.
 * @returns the selected mode, or the default when the log holds no record.
 */
export function orchestrationModeOf(
  projections: Pick<SessionProjectionRegistry, 'stateOf'>,
  session: Session,
): OrchestrationMode {
  return projections.stateOf(session, 'toolAgentTeamOrchestrationMode') ?? DEFAULT_ORCHESTRATION_MODE
}

/**
 * Append one mode selection as a durable, ignorable log record.
 * @param session - Team log receiving the record.
 * @param mode - complete post-change mode.
 * @returns the sequence number of the committed record.
 */
export function recordOrchestrationMode(session: Session, mode: OrchestrationMode): number {
  return appendPluginRecord(session, ORCHESTRATION_MODE_RECORD, { mode })
}

/**
 * Parse one command argument into a mode.
 * @param raw - trimmed command argument.
 * @returns the named mode, or undefined when it names none.
 */
export function parseOrchestrationMode(raw: string): OrchestrationMode | undefined {
  const normalized = raw.trim().toLowerCase()
  return ORCHESTRATION_MODES.find(mode => mode === normalized)
}
