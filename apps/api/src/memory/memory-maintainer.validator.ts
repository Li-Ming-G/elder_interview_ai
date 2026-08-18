import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Injectable } from '@nestjs/common';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';

import { validateMemoryMaintainerV12SemanticPair } from './memory-maintainer-contract-v1-2.js';
import type {
  MemoryMaintainerContextV12,
  MemoryMaintainerOutputV12,
} from './memory-maintainer.provider.js';

@Injectable()
export class MemoryMaintainerV12Validator {
  private readonly context: ValidateFunction;
  private readonly output: ValidateFunction;

  public constructor() {
    const root = findWorkspaceRoot(process.cwd());
    const AjvConstructor = Ajv2020 as unknown as new (options: {
      allErrors: boolean;
      strict: boolean;
    }) => { compile(schema: object): ValidateFunction };
    const ajv = new AjvConstructor({ allErrors: true, strict: false });
    this.context = ajv.compile(
      JSON.parse(
        readFileSync(
          join(root, 'docs/contracts/memory-maintainer-context-v1.2.schema.json'),
          'utf8',
        ),
      ) as object,
    );
    this.output = ajv.compile(
      JSON.parse(
        readFileSync(
          join(root, 'docs/contracts/memory-maintainer-output-v1.2.schema.json'),
          'utf8',
        ),
      ) as object,
    );
  }

  public validateContext(value: unknown): MemoryMaintainerContextV12 {
    if (!this.context(value)) throw new Error('MEMORY_CONTEXT_V12_SCHEMA_INVALID');
    return value as MemoryMaintainerContextV12;
  }

  public validateOutput(
    context: MemoryMaintainerContextV12,
    value: unknown,
  ): MemoryMaintainerOutputV12 {
    if (!this.output(value)) throw new Error('MEMORY_OUTPUT_V12_SCHEMA_INVALID');
    const semantic = validateMemoryMaintainerV12SemanticPair(context, value);
    if (!semantic.valid)
      throw new Error(semantic.errors[0] ?? 'MEMORY_OUTPUT_V12_SEMANTIC_INVALID');
    return value as MemoryMaintainerOutputV12;
  }
}

function findWorkspaceRoot(start: string): string {
  let current = start;
  for (;;) {
    if (existsSync(join(current, 'docs/contracts/memory-maintainer-v1.2.md'))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error('MEMORY_CONTRACT_ROOT_NOT_FOUND');
    current = parent;
  }
}
