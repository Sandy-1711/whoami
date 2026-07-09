// ClackPresenter — the Presenter port implemented with the CLI's clack/
// picocolors UI. The domain reports progress through this; rich one-off
// rendering (score tables, chips) stays in the commands.
import type { Presenter, Spinner } from '@resume/core';
import * as ui from '../ui.js';
import { pc } from '../ui.js';

export class ClackPresenter implements Presenter {
  spinner(initial = ''): Spinner {
    const s = ui.spinner(initial);
    return {
      update: (text) => { s.text = text; },
      succeed: (msg) => s.succeed(msg),
      fail: (msg) => s.fail(msg),
      warn: (msg) => s.warn(msg),
      stop: (msg) => s.stop(msg),
    };
  }
  info(msg: string): void { console.log(ui.info(msg)); }
  warn(msg: string): void { console.log('\n' + ui.warn(msg)); }
  success(msg: string): void { console.log(ui.ok(msg)); }
  note(msg: string): void { console.log('\n' + ui.info(pc.dim(msg))); }
}
