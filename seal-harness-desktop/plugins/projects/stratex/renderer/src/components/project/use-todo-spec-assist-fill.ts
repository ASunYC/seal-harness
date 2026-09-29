import { shallowRef, type Ref } from 'vue';

import type { TodoSpecSuggestion } from '@shared/protocol/project-spec-assist.js';

import { planSpecAssistFill, type SpecAssistField } from './todo-spec-assist';

/**
 * 派单表单「让助理补全」的回填状态（ADR-0043）：只写表单本地字段，⛔ 不碰保存路径。
 *
 * - 空字段直接填入，并记下填入前的值，供「撤销」；
 * - 已填且不同的字段只挂建议，由用户点「用这版替换」或「忽略」；
 * - 「撤销」入口按**值**派生：字段当前值仍等于填入值才显示——用户一改，那段文字就算他自己的，
 *   不另存状态位去跟踪「改没改过」。
 */

type FieldValue<F extends SpecAssistField> = F extends 'acceptanceItems'
  ? readonly string[]
  : string;

interface FilledRecord<F extends SpecAssistField> {
  readonly previous: FieldValue<F>;
  readonly filled: FieldValue<F>;
}

type FilledRecords = { readonly [F in SpecAssistField]?: FilledRecord<F> };
type Suggestions = { readonly [F in SpecAssistField]?: FieldValue<F> };

export interface SpecAssistFieldRefs {
  readonly description: Ref<string>;
  readonly acceptanceItems: Ref<readonly string[]>;
  readonly constraintsText: Ref<string>;
}

const FIELDS: readonly SpecAssistField[] = ['description', 'acceptanceItems', 'constraintsText'];

function sameValue(left: string | readonly string[], right: string | readonly string[]): boolean {
  if (typeof left === 'string' || typeof right === 'string') return left === right;
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function useTodoSpecAssistFill(fields: SpecAssistFieldRefs) {
  const filled = shallowRef<FilledRecords>({});
  const suggestions = shallowRef<Suggestions>({});

  function read<F extends SpecAssistField>(field: F): FieldValue<F> {
    return fields[field].value as FieldValue<F>;
  }

  function write<F extends SpecAssistField>(field: F, value: FieldValue<F>): void {
    if (field === 'acceptanceItems') {
      fields.acceptanceItems.value = [...(value as readonly string[])];
    } else {
      (fields[field] as Ref<string>).value = value as string;
    }
  }

  function recordFill<F extends SpecAssistField>(field: F, value: FieldValue<F>): void {
    filled.value = { ...filled.value, [field]: { previous: read(field), filled: value } };
    write(field, value);
  }

  function withoutSuggestion(field: SpecAssistField): Suggestions {
    const next: Record<string, unknown> = { ...suggestions.value };
    delete next[field];
    return next as Suggestions;
  }

  /** 把一份建议按回填规划落到表单；上一次未采用的建议整体换成这一次的。 */
  function apply(suggestion: TodoSpecSuggestion): void {
    const plan = planSpecAssistFill(
      {
        description: fields.description.value,
        acceptanceItems: fields.acceptanceItems.value,
        constraintsText: fields.constraintsText.value,
      },
      suggestion,
    );
    const nextSuggestions: Record<string, unknown> = {};
    for (const field of FIELDS) {
      const decision = plan[field];
      if (decision.kind === 'fill') recordFill(field, decision.value);
      if (decision.kind === 'suggest') nextSuggestions[field] = decision.value;
    }
    suggestions.value = nextSuggestions as Suggestions;
  }

  function isFilled(field: SpecAssistField): boolean {
    const record = filled.value[field];
    return record !== undefined && sameValue(read(field), record.filled);
  }

  function undo(field: SpecAssistField): void {
    const record = filled.value[field];
    if (record === undefined || !isFilled(field)) return;
    write(field, record.previous);
    const next: Record<string, unknown> = { ...filled.value };
    delete next[field];
    filled.value = next as FilledRecords;
  }

  function suggestionFor<F extends SpecAssistField>(field: F): FieldValue<F> | null {
    return (suggestions.value[field] as FieldValue<F> | undefined) ?? null;
  }

  function accept(field: SpecAssistField): void {
    const value = suggestionFor(field);
    if (value === null) return;
    recordFill(field, value);
    suggestions.value = withoutSuggestion(field);
  }

  function dismiss(field: SpecAssistField): void {
    suggestions.value = withoutSuggestion(field);
  }

  return { apply, isFilled, undo, suggestionFor, accept, dismiss };
}
