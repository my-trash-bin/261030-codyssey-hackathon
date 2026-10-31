import type { WorkflowCatalog } from './workflow-session.ts';
import { deny } from './workflow-session.ts';
import type { Intake } from './rule-store.ts';
import type { TaskContext } from '@safehandoff/core-interface';
export const purposes = [
  { id: 'oss_issue', display_name: '오픈소스 버그 제보' },
  { id: 'vendor_support', display_name: '기술지원 문의' },
  { id: 'operations_advice', display_name: '운영 자문' },
];
export const goals = ['default', 'observations_only', 'ask_for_diagnostics', 'reproduction_evidence'];
export function validateCatalog(value: unknown): WorkflowCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_WORKFLOW_CATALOG');
  const c = value as WorkflowCatalog;
  if (Object.keys(c).sort().join(',') !== 'projects,recipients') throw new Error('INVALID_WORKFLOW_CATALOG');
  for (const list of [c.projects, c.recipients]) {
    if (!Array.isArray(list) || list.length > 100 || new Set(list.map(v => v?.id)).size !== list.length ||
      list.some(v => !v || Object.keys(v).sort().join(',') !== 'display_name,id' || typeof v.id !== 'string' ||
        !/^[A-Za-z0-9_.:-]{1,128}$/.test(v.id) || typeof v.display_name !== 'string' || !v.display_name.trim() || v.display_name.length > 256)) throw new Error('INVALID_WORKFLOW_CATALOG');
  }
  return structuredClone(c);
}
export function intakeContext(input: unknown, catalog: WorkflowCatalog): { intake: Intake; context: TaskContext } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) deny(400, 'INVALID_INTAKE');
  const v = input as Intake & { goal_variant?: TaskContext['goal_variant']; output_language?: 'ko' | 'en' };
  const required = ['internal_title', 'project_id', 'purpose_id', 'recipient_id', 'audience', 'skill_ids'];
  if (required.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => ![...required, 'goal_variant', 'output_language'].includes(k)) ||
    typeof v.internal_title !== 'string' || !v.internal_title.trim() || v.internal_title.length > 256 ||
    !catalog.projects.some(p => p.id === v.project_id) || !purposes.some(p => p.id === v.purpose_id) ||
    !catalog.recipients.some(r => r.id === v.recipient_id) || !['public', 'named_external'].includes(v.audience) ||
    !Array.isArray(v.skill_ids) || v.skill_ids.length || (v.goal_variant !== undefined && !goals.includes(v.goal_variant)) ||
    (v.output_language !== undefined && !['ko', 'en'].includes(v.output_language))) deny(400, 'INVALID_INTAKE');
  const { goal_variant, output_language, ...intake } = v;
  return { intake, context: { purpose: v.purpose_id, recipient: v.recipient_id, ...(goal_variant ? { goal_variant } : {}), ...(output_language ? { output_language } : {}) } };
}
