import { deny } from './workflow-session.ts';
import type { Intake } from './rule-store.ts';
import type { TaskContext } from '@safehandoff/core-interface';
export const purposes = [
  { id: 'oss_issue', display_name: '오픈소스 버그 제보' },
  { id: 'vendor_support', display_name: '기술지원 문의' },
  { id: 'operations_advice', display_name: '운영 자문' },
];
export const goals = ['default', 'observations_only', 'ask_for_diagnostics'];
export function intakeContext(input: unknown): { intake: Intake; context: TaskContext } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) deny(400, 'INVALID_INTAKE');
  const v = input as Intake & { goal_variant?: TaskContext['goal_variant']; output_language?: 'ko' | 'en' };
  const required = ['internal_title', 'purpose_id', 'recipient_id', 'audience', 'skill_ids'];
  if (required.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => ![...required, 'project_id', 'goal_variant', 'output_language'].includes(k)) ||
    typeof v.internal_title !== 'string' || !v.internal_title.trim() || v.internal_title.length > 256 ||
    (v.project_id !== undefined && (typeof v.project_id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(v.project_id))) || !purposes.some(p => p.id === v.purpose_id) ||
    typeof v.recipient_id !== 'string' || !v.recipient_id.trim() || v.recipient_id.length > 256 || !['public', 'named_external'].includes(v.audience) ||
    !Array.isArray(v.skill_ids) || v.skill_ids.length || (v.goal_variant !== undefined && !goals.includes(v.goal_variant)) ||
    (v.output_language !== undefined && !['ko', 'en'].includes(v.output_language))) deny(400, 'INVALID_INTAKE');
  const { goal_variant, output_language, ...fields } = v;
  const intake = { ...fields, project_id: v.project_id ?? 'workspace' };
  return { intake, context: { purpose: v.purpose_id, recipient: v.recipient_id, ...(goal_variant ? { goal_variant } : {}), ...(output_language ? { output_language } : {}) } };
}
