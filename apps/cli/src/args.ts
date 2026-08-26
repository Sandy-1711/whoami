// Tiny argv reader for the CLI. Kept pure (takes an argv array, returns getters)
// so command routing in cli.ts stays declarative and the parsing is unit-testable.

// Flags that consume the following token as their value, so a value like
// "--company Acme" is never mistaken for a positional argument.
export const VALUE_FLAGS = ['--jd', '--company', '--name', '--to', '--attach', '--path'];

// `--word`, the shape of another flag. A JD that opens with a `---` rule is not
// one, so the test is "two dashes then a letter".
const FLAG_SHAPED = /^--[a-z]/i;

export interface Args {
  // The leading sub-command ('tailor', 'sync', …), or '' when the first token is a flag.
  cmd: string;
  // Is this boolean flag present?
  has(flag: string): boolean;
  // The value after `flag`, or `fallback` when absent. Throws when `flag` is
  // present but the next token is another flag — swallowing it silently turns a
  // typo into a run against the wrong company.
  opt(flag: string, fallback?: string): string;
  // Bare positionals — tokens that are neither flags nor a flag's value.
  positionals(): string[];
}

export function parseArgs(argv: string[]): Args {
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
  return {
    cmd,
    has: (flag) => argv.includes(flag),
    opt: (flag, fallback = '') => {
      const i = argv.indexOf(flag);
      if (i < 0) return fallback;
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${flag} needs a value.`);
      if (FLAG_SHAPED.test(value)) throw new Error(`${flag} needs a value — got the flag ${value}.`);
      return value;
    },
    positionals: () =>
      argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !VALUE_FLAGS.includes(arr[i - 1]!)),
  };
}
