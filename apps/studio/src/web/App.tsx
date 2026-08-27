// The studio: threads and status down the left, the conversation in the middle,
// the document and its render on the right. Nothing navigates — the point is to
// watch a turn and the thing it changed at the same time.
//
// Every gutter is a splitter, so which of those matters most right now is the
// reader's call and not the layout's. Sizes are this session's: a reload is a
// fresh start, and nothing about a pane width is worth persisting behind
// somebody's back.
import { useState } from 'react';
import { useChat } from './useChat';
import { useResume } from './useResume';
import { AskModal } from './components/AskModal';
import { ChatPane } from './components/ChatPane';
import { ConfirmModal } from './components/ConfirmModal';
import { CANONICAL, PdfPreview } from './components/PdfPreview';
import { ResumeEditor } from './components/ResumeEditor';
import { Splitter, usePaneSize } from './components/Splitter';
import { StatusRail } from './components/StatusRail';
import { ThreadList } from './components/ThreadList';

// The width of a splitter's own grid track: the gutter between two panes.
const GUTTER = 10;

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

  const [railWidth, dragRail] = usePaneSize('x', 224, 140);
  const [threadsHeight, dragThreads] = usePaneSize('y', 220, 80);
  const [docWidth, dragDoc] = usePaneSize('x', 640, 260);
  const [editorWidth, dragEditor] = usePaneSize('x', 360, 240);

  // The editor takes its width from the conversation, not from the render
  // beside it: opening it otherwise squeezes the pdf pane down to where its own
  // picker no longer fits, which is a strange way to be shown a document.
  const toggleEditor = (): void => {
    dragDoc(editing ? -(editorWidth + GUTTER) : editorWidth + GUTTER);
    setEditing(!editing);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-baseline gap-3 border-b border-zinc-800 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-wide text-zinc-100">résumé studio</h1>
        <span className="text-[11px] text-zinc-600">
          local · thread {chat.threadId.slice(0, 8)}
        </span>
      </header>

      <main
        className="grid min-h-0 flex-1 p-2"
        style={{ gridTemplateColumns: `${railWidth}px ${GUTTER}px minmax(0,1fr) ${GUTTER}px ${docWidth}px` }}
      >
        <div className="grid min-h-0 min-w-0" style={{ gridTemplateRows: `${threadsHeight}px ${GUTTER}px minmax(0,1fr)` }}>
          <ThreadList
            current={chat.threadId}
            version={chat.completed}
            onOpen={(id) => { void chat.openThread(id); }}
            onDeleted={(id) => { if (id === chat.threadId) chat.startThread(); }}
          />
          <Splitter axis="y" onDrag={dragThreads} />
          <StatusRail />
        </div>

        <Splitter axis="x" onDrag={dragRail} />

        <ChatPane
          turns={chat.turns}
          running={chat.running}
          onSend={(message) => { void chat.send(message); }}
          onStop={chat.stop}
          onNewThread={chat.startThread}
          onPreview={setShowing}
        />

        {/* The pane on the right of a handle grows as the pointer goes left. */}
        <Splitter axis="x" onDrag={(delta) => dragDoc(-delta)} />

        <div
          className="grid min-h-0 min-w-0"
          style={{ gridTemplateColumns: editing ? `${editorWidth}px ${GUTTER}px minmax(0,1fr)` : 'minmax(0,1fr)' }}
        >
          {editing ? (
            <>
              <ResumeEditor doc={doc} onClose={toggleEditor} />
              <Splitter axis="x" onDrag={dragEditor} />
            </>
          ) : null}
          {/* A finished turn bumps the version too: it may have written a file
              the picker has not listed yet. */}
          <PdfPreview
            version={doc.built + chat.completed}
            showing={showing}
            onShow={setShowing}
            editing={editing}
            dirty={doc.dirty}
            onEdit={toggleEditor}
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
