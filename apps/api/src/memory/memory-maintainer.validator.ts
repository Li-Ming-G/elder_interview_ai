import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Injectable } from '@nestjs/common';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';

import { validateMemoryMaintainerV11SemanticPair } from './memory-maintainer-contract-v1-1.js';
import type {
  MemoryMaintainerContextV11,
  MemoryMaintainerOutputV11,
} from './memory-maintainer.provider.js';

@Injectable()
export class MemoryMaintainerV11Validator {
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
          join(root, 'docs/contracts/memory-maintainer-context-v1.1.schema.json'),
          'utf8',
        ),
      ) as object,
    );
    this.output = ajv.compile(
      JSON.parse(
        readFileSync(
          join(root, 'docs/contracts/memory-maintainer-output-v1.1.schema.json'),
          'utf8',
        ),
      ) as object,
    );
  }

  public validateContext(value: unknown): MemoryMaintainerContextV11 {
    if (!this.context(value)) throw new Error('MEMORY_CONTEXT_V11_SCHEMA_INVALID');
    return value as MemoryMaintainerContextV11;
  }

  public validateOutput(
    context: MemoryMaintainerContextV11,
    value: unknown,
  ): MemoryMaintainerOutputV11 {
    if (!this.output(value)) throw new Error('MEMORY_OUTPUT_V11_SCHEMA_INVALID');
    const semantic = validateMemoryMaintainerV11SemanticPair(context, value);
    if (!semantic.valid)
      throw new Error(semantic.errors[0] ?? 'MEMORY_OUTPUT_V11_SEMANTIC_INVALID');
    return value as MemoryMaintainerOutputV11;
  }
}

function findWorkspaceRoot(start: string): string {
  let current = start;
  for (;;) {
    if (existsSync(join(current, 'docs/contracts/memory-maintainer-v1.1.md'))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error('MEMORY_CONTRACT_ROOT_NOT_FOUND');
    current = parent;
  }
}
