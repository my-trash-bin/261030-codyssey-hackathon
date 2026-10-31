import { jsonSchema } from 'ai';
import type { ToolSet } from 'ai';
import { toVercelTools } from '@typia/vercel';
import { LlmJson } from '@typia/utils';
import type { ILlmController, ILlmFunction, ILlmSchema, IValidation } from '@typia/interface';
import type { ModelCallOptions } from '@safehandoff/core-interface';

// Preserve the core parser's duplicate-key boundary before SDK JSON parsing can
// discard repeated (including escaped) property names. Syntax recovery is separate.
export function uniqueKeys(input: string): boolean {
  const stack: (Set<string> | null)[] = []; let previous = '', offset = 0;
  try {
    for (const match of input.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_$][\w$]*/g)) {
      if (input.slice(offset, match.index).trim()) return false;
      const token = match[0]; offset = match.index + token.length;
      if (token === '{') stack.push(new Set());
      else if (token === '[') stack.push(null);
      else if (token === '}' || token === ']') stack.pop();
      else if (token === ':') {
        const keys = stack.at(-1), key: unknown = previous.startsWith('"') ? JSON.parse(previous) :
          /^[A-Za-z_$][\w$]*$/.test(previous) ? previous : undefined;
        if (!keys || typeof key !== 'string' || keys.has(key)) return false;
        keys.add(key);
      }
      previous = token;
    }
    return !input.slice(offset).trim();
  } catch { return false; }
}
export function submissionTool(output: NonNullable<ModelCallOptions['output']>, raw: () => string | undefined) {
  const parameters: ILlmSchema.IParameters = { ...output.schema, $defs: {} };
  const validateType = LlmJson.validate(parameters, true, { strict: false });
  const failure = (data: unknown): IValidation.IFailure => ({ success: false, data,
    errors: [{ path: '$input', expected: 'valid current-role result with authorized references and unique keys', value: undefined }] });
  const validate = (data: unknown): IValidation => {
    const checked = validateType(data);
    if (!checked.success) return checked;
    try { return { success: true, data: output.validate(JSON.stringify(checked.data)) }; }
    catch { return failure(data); }
  };
  const func: ILlmFunction = { name: 'submit', description: 'Submit the structured result for this role. This never grants disclosure permission.',
    parameters, parse: input => LlmJson.parse(input, parameters), coerce: data => LlmJson.coerce(data, parameters), validate };
  let accepted: unknown;
  const controller: ILlmController<{ submit(data: unknown): void }> = { protocol: 'class', name: 'result',
    application: { functions: [func], config: { strict: false, validate: null } }, execute: { submit: data => { accepted = data; } } };
  const generated = toVercelTools(controller);
  const check = (data: unknown): IValidation => raw() !== undefined && !uniqueKeys(raw()!) ? failure(data) : LlmJson.validateArguments(func, data);
  const tools: ToolSet = { submit: { ...generated.submit!, inputSchema: jsonSchema(parameters, {
    validate: data => {
      const result = check(data);
      return result.success ? { success: true, value: result.data } : { success: false, error: new Error('Invalid structured result') };
    } }) } };
  return { tools, accepted: () => accepted,
    recover: (input: string): unknown => {
      if (!uniqueKeys(input)) return undefined;
      const parsed = func.parse(input);
      if (!parsed.success) return undefined;
      const result = validate(parsed.data); return result.success ? result.data : undefined;
    },
    feedback: (input: string): string => {
      const parsed = func.parse(input), result = parsed.success ? validate(parsed.data) : failure(undefined);
      // Diagnostic data stays in this same role/session. No provider error text is used.
      return result.success ? 'Call submit with the complete result.' : LlmJson.stringify(result);
    } };
}
