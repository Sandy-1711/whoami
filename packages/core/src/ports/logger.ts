// Presenter port — how the domain reports progress and status. The CLI provides
// a rich clack/picocolors implementation; tests use a no-op. Rich, one-off
// rendering (score tables, keyword chips, the ATS report) stays in the CLI: the
// tailor pipeline returns structured data and the CLI decides how to draw it.

export interface Spinner {
  update(text: string): void;
  succeed(msg?: string): void;
  fail(msg?: string): void;
  warn(msg?: string): void;
  stop(msg?: string): void;
}

export interface Presenter {
  spinner(initial?: string): Spinner;
  info(msg: string): void;
  warn(msg: string): void;
  success(msg: string): void;
  note(msg: string): void;
}

// A Presenter that draws nothing — handy for tests and non-interactive runs.
export const silentPresenter: Presenter = {
  spinner: () => ({ update() {}, succeed() {}, fail() {}, warn() {}, stop() {} }),
  info() {},
  warn() {},
  success() {},
  note() {},
};
