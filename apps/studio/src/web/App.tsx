// The studio: threads and status down the left, the conversation in the middle,
// the document and its render on the right. Nothing navigates — the point is to
// watch a turn and the thing it changed at the same time.
import { useState } from 'react';
import { useChat } from './useChat';
import { useResume } from './useResume';
import { AskModal } from './components/AskModal';
import { ChatPane } from './components/ChatPane';
import { ConfirmModal } from './components/ConfirmModal';
import { CANONICAL, PdfPreview } from './components/PdfPreview';
import { ResumeEditor } from './components/ResumeEditor';
import { StatusRail } from './components/StatusRail';
import { ThreadList } from './components/ThreadList';

export function App() {
  const chat = useChat();
  // The document outlives the pane that edits it: closing the editor with an
  // edit in it must not be how the edit is lost.
  const doc = useResume();
  // Editing the base résumé is the occasional, deliberate act; watching a turn
  // is the normal one, so the pdf pane has the column until this is asked for.
  const [editing, setEditing] = useState(false);
  // Which PDF the preview shows. Here rather than in the pane because a card in
  // the transcript sets it as well as the pane's own picker.
  const [showing, setShowing] = useState(CANONICAL);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-baseline gap-3 border-b border-zinc-800 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-wide text-zinc-100">résumé studio</h1>
        <span className="text-[11px] text-zinc-600">
          local · thread {chat.threadId.slice(0, 8)}
        </span>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[14rem_minmax(0,1fr)_minmax(0,1.5fr)] gap-2 p-2">
        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
          <ThreadList
            current={chat.threadId}
            version={chat.completed}
            onOpen={(id) => { void chat.openThread(id); }}
            onDeleted={(id) => { if (id === chat.threadId) chat.startThread(); }}
          />
          <StatusRail />
        </div>

        <ChatPane
          turns={chat.turns}
          running={chat.running}
          onSend={(message) => { void chat.send(message); }}
          onStop={chat.stop}
          onNewThread={chat.startThread}
          onPreview={setShowing}
        />

        <div className={`grid min-h-0 min-w-0 gap-2 ${
          editing ? 'grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]' : 'grid-cols-1'
        }`}>
          {editing ? <ResumeEditor doc={doc} onClose={() => setEditing(false)} /> : null}
          {/* A finished turn bumps the version too: it may have written a file
              the picker has not listed yet. */}
          <PdfPreview
            version={doc.built + chat.completed}
            showing={showing}
            onShow={setShowing}
            editing={editing}
            dirty={doc.dirty}
            onEdit={() => setEditing(!editing)}
          />
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
