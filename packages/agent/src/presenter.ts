// A Presenter (the core progress port) that forwards every spinner/status event
// to a single sink as a formatted line. The chat CLI injects a sink that prints
// these as dim, live progress under the current turn, so a long tool call
// (scraping, rendering) isn't a silent hang. Tests inject a collecting sink.
import type { Presenter, Spinner } from '@resume/core';

export type ProgressSink = (line: string) => void;

export function progressPresenter(sink: ProgressSink): Presenter {
  const emit = (prefix: string, text?: string): void => { if (text && text.trim()) sink(prefix + text); };
  const spinner = (initial?: string): Spinner => {
    emit('… ', initial);
    return {
      update: (t) => emit('… ', t),
      succeed: (m) => emit('✓ ', m),
      fail: (m) => emit('✗ ', m),
      warn: (m) => emit('⚠ ', m),
      stop: (m) => emit('· ', m),
    };
  };
  return {
    spinner,
    info: (m) => emit('· ', m),
    warn: (m) => emit('⚠ ', m),
    success: (m) => emit('✓ ', m),
    note: (m) => emit('· ', m),
  };
}
