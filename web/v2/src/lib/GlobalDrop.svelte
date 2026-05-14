<script>
  // Window-level drag-and-drop overlay. Active even when a file is already
  // loaded — mirrors v1's `.global-drop`. On drop runs the shared loadFile
  // pipeline and hands the result up via {onfile}.
  import { readFile } from './loadFile.js';

  let { onfile, onerror } = $props();

  let active = $state(false);
  // Drag counter: dragenter/leave fire per child, so we count to know when
  // we've truly left the window. Standard pattern.
  let depth = 0;

  function isFileDrag(e) {
    const dt = e.dataTransfer;
    if (!dt) return false;
    const types = dt.types;
    if (!types) return false;
    // `types` is DOMStringList in Firefox, array-like elsewhere.
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  }

  $effect(() => {
    function onEnter(e) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth++;
      active = true;
    }
    function onOver(e) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      // Tell the browser this is a copy/drop target.
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }
    function onLeave(e) {
      if (!isFileDrag(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) active = false;
    }
    async function onDrop(e) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth = 0;
      active = false;
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      try {
        const payload = await readFile(f);
        onfile?.(payload);
      } catch (err) {
        onerror?.(err.message || String(err));
      }
    }

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  });
</script>

{#if active}
  <div class="global-drop" aria-hidden="true">
    <div class="panel">
      <div class="title">Release to load</div>
      <div class="sub">drop binary anywhere</div>
    </div>
  </div>
{/if}

<style>
  .global-drop {
    position: fixed;
    inset: 0;
    z-index: 999;
    background: var(--tint-drop);
    border: 3px dashed var(--mint-deep);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    animation: gd-in var(--t-fast);
  }
  .panel {
    border: 1px solid var(--mint-deep);
    background: var(--paper);
    padding: 28px 56px;
    text-align: center;
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  }
  .title {
    font-size: var(--fs-h4);
    letter-spacing: var(--tr-label);
    color: var(--mint-deep);
    text-transform: uppercase;
  }
  .sub {
    margin-top: 6px;
    font-size: var(--fs-label);
    letter-spacing: var(--tr-bracket);
    color: var(--muted);
    text-transform: uppercase;
  }
  @keyframes gd-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
</style>
