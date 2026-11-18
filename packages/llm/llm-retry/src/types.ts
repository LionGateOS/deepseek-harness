import type { LlmFailure } from '@deepseek-ai/dsh-llm/types'
import type { RetryId } from './brand.ts'
import type { PlacementTarget } from '@deepseek-ai/dsh-agent-default-model'

export type { RetryId }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable, non-surface record of one provider-routed retry scheduled after a failed request attempt. */
    'llm/retry': LlmRetryEventData
    /** Durable transition written after a retry wait succeeds and before the next request attempt starts. */
    'llm/retry-started': LlmRetryStartedEventData
    /** Durable record of one bounded inter-provider fallback transition after retry exhaustion. */
    'llm/fallback': LlmFallbackEventData
  }
}

/**
 * Policy surface a host supplies so exhausted retries can select a fallback
 * route. `@deepseek-ai/dsh-agent-default-model` satisfies this structurally;
 * this package keeps no dependency on it.
 */
export interface LlmFallbackPolicySource {
  /**
   * Find the owner-approved automatic-fallback route, if any.
   * @returns the eligible fallback candidate identity (provider + model), or
   *   `null` when none qualifies or the candidate lacks an explicit model.
   */
  findFallbackProvider(): Pick<PlacementTarget, 'provider' | 'model'> | null
  /**
   * Read the current default selection for model ids.
   * @returns the current provider/model selection.
   */
  currentSelection(): { provider: string; model: string }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional owner of fallback policy data; absent when the host does not provide default-model selection. */
    agentDefaultModel?: LlmFallbackPolicySource
  }
}

/** Durable payload recorded when one failed request transitions to its fallback route. */
export interface LlmFallbackEventData {
  /** Provider whose retries were exhausted. */
  failedProvider: string
  /** Model id of the failed route. */
  failedModel: string
  /** Normalized failure code that exhausted intra-provider retry. */
  failureCode: string
  /** Provider id of the authorized fallback candidate. */
  candidateProvider: string
  /** Model id routed to the fallback candidate. */
  candidateModel: string
  /** One-based inter-provider transition count for this request; always 1. */
  attempt: number
  /** Routes excluded from candidacy and why (owner approval or GPU policy), when any. */
  excludedRoutes: Array<{ provider: string; reason: string }>
}

/** Durable payload recorded before one provider-routed model-request retry wait. */
export type LlmRetryEventData =
  | {
    retryId: RetryId
    turn: number
    step: number
    provider: string
    mode: 'normal'
    policyKey: string
    retry: number
    maxRetries: number
    delayMs: number
    failure: LlmFailure
  }

  | {
    retryId: RetryId
    turn: number
    step: number
    provider: string
    mode: 'always'
    policyKey: string
    retry: number
    delayMs: number
    failure: LlmFailure
  }

/** Durable transition recorded after one retry delay completes. */
export interface LlmRetryStartedEventData {
  retryId: RetryId
  turn: number
  step: number
  retry: number
}
