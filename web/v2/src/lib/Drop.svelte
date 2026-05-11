<script>
  // Drop-target shell. Emits the dropped/selected file via the `onfile` prop.
  let { onfile } = $props();

  const MAX_BYTES = 64 * 1024 * 1024;
  let hover = $state(false);
  let err = $state('');

  function fmt(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KiB';
    return (n / 1024 / 1024).toFixed(1) + ' MiB';
  }

  async function accept(file) {
    err = '';
    if (file.size > MAX_BYTES) {
      err = `file too large (${fmt(file.size)} > ${fmt(MAX_BYTES)})`;
      return;
    }
    const buf = await file.arrayBuffer();
    onfile?.({ name: file.name, bytes: new Uint8Array(buf) });
  }

  function onDrop(e) {
    e.preventDefault();
    hover = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) accept(f);
  }
  function onDragOver(e) { e.preventDefault(); hover = true; }
  function onDragLeave() { hover = false; }
  function onPick(e) {
    const f = e.target.files?.[0];
    if (f) accept(f);
  }
</script>

<div
  class="drop"
  class:hover
  ondrop={onDrop}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  role="region"
  aria-label="Drop a binary"
>
  <p class="ti">[ DROP A BINARY ]</p>
  <p class="sub">Drag an ELF onto this panel, or use the picker.</p>
  <label class="pick">
    <input type="file" hidden onchange={onPick} />
    <span>Choose file</span>
  </label>
  {#if err}
    <p class="err">{err}</p>
  {/if}
  <p class="legend">All parsing happens in this tab. Nothing leaves your browser.</p>
</div>

<style>
  .drop {
    border: 1px dashed var(--rule);
    background: var(--paper);
    padding: 56px 40px;
    text-align: center;
    transition: border-color 160ms ease, background 160ms ease;
  }
  .drop.hover { border-color: var(--mint-deep); background: var(--mint-pale); }
  .ti {
    font-size: 10px;
    letter-spacing: 0.16em;
    color: var(--mint-deep);
    margin-bottom: 12px;
  }
  .sub { color: var(--muted); margin-bottom: 22px; }
  .pick span {
    display: inline-block;
    border: 1px solid var(--rule);
    padding: 6px 14px;
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--mint-deep);
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease;
  }
  .pick:hover span { border-color: var(--mint-deep); background: var(--mint-pale); }
  .err { color: #c0392b; margin-top: 14px; font-size: 11px; }
  .legend {
    margin-top: 28px;
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
  }
</style>
