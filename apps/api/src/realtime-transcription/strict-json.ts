export class StrictJsonError extends Error {}

/** Rejects duplicate object keys before using the platform JSON parser. */
export function parseStrictJson(raw: string): unknown {
  new DuplicateKeyScanner(raw).scan();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new StrictJsonError('Invalid JSON');
  }
}

class DuplicateKeyScanner {
  private position = 0;

  public constructor(private readonly input: string) {}

  public scan(): void {
    this.skipWhitespace();
    this.value();
    this.skipWhitespace();
    if (this.position !== this.input.length) this.fail();
  }

  private value(): void {
    this.skipWhitespace();
    const current = this.input[this.position];
    if (current === '{') {
      this.object();
      return;
    }
    if (current === '[') {
      this.array();
      return;
    }
    if (current === '"') return void this.string();
    if (current === 't') {
      this.literal('true');
      return;
    }
    if (current === 'f') {
      this.literal('false');
      return;
    }
    if (current === 'n') {
      this.literal('null');
      return;
    }
    this.number();
  }

  private object(): void {
    this.position += 1;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.input[this.position] === '}') {
      this.position += 1;
      return;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.input[this.position] !== '"') this.fail();
      const key = this.string();
      if (keys.has(key)) throw new StrictJsonError('Duplicate JSON key');
      keys.add(key);
      this.skipWhitespace();
      if (this.input[this.position] !== ':') this.fail();
      this.position += 1;
      this.value();
      this.skipWhitespace();
      const delimiter = this.input[this.position];
      this.position += 1;
      if (delimiter === '}') return;
      if (delimiter !== ',') this.fail();
    }
  }

  private array(): void {
    this.position += 1;
    this.skipWhitespace();
    if (this.input[this.position] === ']') {
      this.position += 1;
      return;
    }
    for (;;) {
      this.value();
      this.skipWhitespace();
      const delimiter = this.input[this.position];
      this.position += 1;
      if (delimiter === ']') return;
      if (delimiter !== ',') this.fail();
    }
  }

  private string(): string {
    const start = this.position;
    this.position += 1;
    while (this.position < this.input.length) {
      const current = this.input[this.position];
      this.position += 1;
      if (current === '"') {
        try {
          return JSON.parse(this.input.slice(start, this.position)) as string;
        } catch {
          this.fail();
        }
      }
      if (current === '\\') this.position += 1;
      else if (current !== undefined && current.charCodeAt(0) < 0x20) this.fail();
    }
    this.fail();
  }

  private literal(expected: string): void {
    if (this.input.slice(this.position, this.position + expected.length) !== expected) this.fail();
    this.position += expected.length;
  }

  private number(): void {
    const rest = this.input.slice(this.position);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (match === null) this.fail();
    this.position += match[0].length;
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.input[this.position] ?? 'x')) this.position += 1;
  }

  private fail(): never {
    throw new StrictJsonError('Invalid JSON');
  }
}
