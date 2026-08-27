// The studio: threads and status down the left, the conversation in the middle,
// the document and its render on the right. Nothing navigates — the point is to
// watch a turn and the thing it changed at the same time.
import { useState } from 'react';
import { useChat } from './useChat';
import { AskModal } from './components/AskModal';
import { ChatPane } from './components/ChatPane';
import { ConfirmModal } from './components/ConfirmModal';
import { PdfPreview } from './components/PdfPreview';
import { ResumeEditor } from './components/ResumeEditor';
import { StatusRail } from './components/StatusRail';
import { ThreadList } from './components/ThreadList';

export function App() {
  const chat = useChat();
  // Bumped after every build so the preview reloads instead of showing the
  // document as it was before the compile that was just watched finish.
  const [built, setBuilt] = useState(0);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-baseline gap-3 border-b border-zinc-800 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-wide text-zinc-100">résumé studio</h1>
        <span className="text-[11px] text-zinc-600">
          local · thread {chat.threadId.slice(0, 8)}
        </span>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1.1fr)_minmax(0,1.4fr)] gap-2 p-2">
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
          <ThreadList current={chat.threadId} onOpen={(id) => { void chat.openThread(id); }} />
          <StatusRail />
        </div>

        <ChatPane
          turns={chat.turns}
          running={chat.running}
          onSend={(message) => { void chat.send(message); }}
          onStop={chat.stop}
          onNewThread={chat.startThread}
        />

        <div className="grid min-h-0 grid-cols-2 gap-2">
          <ResumeEditor onBuilt={() => setBuilt((n) => n + 1)} />
          <PdfPreview version={built} />
        </div>
      </main>

      {chat.confirm
        ? <ConfirmModal prompt={chat.confirm} onAnswer={(ok) => { void chat.resolveConfirm(ok); }} />
        : null}
      {chat.ask
        ? <AskModal prompt={chat.ask} onAnswer={(answers) => { void chat.resolveAsk(answers); }} />
        : null}
    </div>
  );
}
