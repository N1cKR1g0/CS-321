/**
 * ui.js
 * UI LAYER — User Interface
 *
 * Responsibilities:
 *  - Initialize TinyMCE editor
 *  - Wire editor change events → MindmapService → D3 renderer
 *  - Render the mindmap SVG using D3
 *  - Handle Save button → FirebaseService
 *  - Handle Export modal (PNG, JSON, Share link)
 *  - Auto-load a shared document from URL on page load
 *
 * This module calls MindmapService for business logic
 * and FirebaseService for persistence.
 * It does NOT contain any parsing or data logic itself.
 */

const UI = (() => {

  // state
  let currentDocId = null;       // Firestore ID of the currently open document
  let currentTree = null;        // Last rendered mindmap tree
  let saveTimeout = null;        // Debounce timer for auto-save

  // tinymce initialization

  function initEditor() {
    tinymce.init({
      selector: '#editor-textarea',
      license_key: 'gpl',
      height: '100%',
      menubar: false,
      plugins: [
        'anchor', 'autolink', 'charmap', 'codesample', 'emoticons',
        'link', 'lists', 'media', 'searchreplace', 'table',
        'visualblocks', 'wordcount'
      ],
      toolbar: 'undo redo | blocks fontfamily fontsize | bold italic underline strikethrough | link media table | align lineheight | checklist numlist bullist indent outdent | emoticons charmap | removeformat',

      setup(editor) {
        editor.on('input change', () => {
          const html = editor.getContent();
          onContentChange(html);
        });

        editor.on('init', async () => {
          // If a doc ID is in the URL, load it
          const sharedDocId = FirebaseService.getDocIdFromUrl();
          if (sharedDocId) {
            await loadSharedDocument(sharedDocId, editor);
          }
        });
      }
    });
  }

  // content change

  /**
   * called on every editor change
   * delegates parsing/hierarchy to MindmapService, then renders
   * triggers auto-save
   *
   * @param {string} html - Raw HTML from TinyMCE
   */
  function onContentChange(html) {
    const tree = MindmapService.buildMindmapFromContent(html);
    currentTree = tree;
    renderMindmap(tree);
    scheduleAutoSave(html);
  }

  // d3 mind map renderer

  /**
   * renders mindmap hierarchy as d3 tree with elliptical nodes
   * 
   *
   * @param {Object|null} tree - mindmap tree from MindmapService
   */
  function renderMindmap(tree) {
    const container = document.querySelector('.right-panel');
    const svg_container = document.getElementById('mindmap');
    d3.select(svg_container).selectAll('*').remove();

    if (!tree) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const svg = d3.select(svg_container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g');

    // enable pan zoom
    svg.call(
      d3.zoom().on('zoom', (event) => {
        g.attr('transform', event.transform);
      })
    );

    const root = d3.hierarchy(tree);
    const treeLayout = d3.tree().size([width - 100, height - 100]);
    treeLayout(root);

    // draw links
    g.selectAll('line')
      .data(root.links())
      .enter()
      .append('line')
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y + 50)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y + 50)
      .attr('stroke', '#c4a0ff')
      .attr('stroke-width', 1.5);

    // drawing nodes
    const nodes = g.selectAll('g.node')
      .data(root.descendants())
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.x}, ${d.y + 50})`);

    // measure text first, then draw ellipse behind it
    const texts = nodes.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', 'white')
      .attr('font-size', d => Math.max(11, 14 - d.depth))
      .text(d => d.data.name)
      .each(function(d) {
        d.textWidth = this.getBBox().width;
      });

    nodes.insert('ellipse', 'text')
      .attr('rx', d => Math.max(40, d.textWidth / 2 + 14))
      .attr('ry', d => Math.max(16, 25 - d.depth * 2))
      .attr('fill', d => {
        // color nodes by depth
        const colors = ['#7b2ff7', '#9b51e0', '#b06fd8', '#c48fd0', '#d8b0e8'];
        return colors[Math.min(d.depth, colors.length - 1)];
      })
      .attr('stroke', 'white')
      .attr('stroke-width', 1.5);
  }

  // saving files

  /**
   * Debounced auto-save: waits 2 seconds after last keystroke before saving.
   * @param {string} html - Current editor HTML
   */
  function scheduleAutoSave(html) {
    clearTimeout(saveTimeout);
    setSaveStatus('Unsaved changes...');
    saveTimeout = setTimeout(() => saveDocument(html), 2000);
  }

  /**
   * saves current doc firebase
   * extracts the title from the first header in the content
   *
   * @param {string} html - Editor HTML content
   */
  async function saveDocument(html) {
    setSaveStatus('Saving...');
    try {
      const serializedTree = MindmapService.serializeTree(currentTree);
      const title = extractTitle(html);

      currentDocId = await FirebaseService.saveDocument({
        id: currentDocId,
        title,
        content: html,
        mindmapTree: serializedTree,
      });

      setSaveStatus('Saved ✓');
    } catch (err) {
      console.error('[UI] Save failed:', err);
      setSaveStatus('Save failed ✗');
    }
  }

  /**
   * extracts a document title from the first header in the HTML
   * falls back to 'Untitled Document'
   *
   * @param {string} html
   * @returns {string}
   */
  function extractTitle(html) {
    const headers = MindmapService.extractHeaders(html);
    return headers.length > 0 ? headers[0].textContent.trim() : 'Untitled Document';
  }

  /**
   * updates the save status label in the title bar.
   * @param {string} msg
   */
  function setSaveStatus(msg) {
    const el = document.getElementById('save-status');
    if (el) el.textContent = msg;
  }

  // loading shared doc

  /**
   * loads a shared document from Firebase and populates the editor
   * 
   *
   * @param {string} docId
   * @param {Object} editor - TinyMCE editor instance
   */
  async function loadSharedDocument(docId, editor) {
    try {
      setSaveStatus('Loading...');
      const doc = await FirebaseService.loadDocument(docId);
      if (!doc) {
        setSaveStatus('Document not found.');
        return;
      }
      currentDocId = doc.id;
      editor.setContent(doc.content || '');
      // Re-render the mindmap from loaded content
      onContentChange(doc.content || '');
      setSaveStatus('Loaded ✓');
    } catch (err) {
      console.error('[UI] Load failed:', err);
      setSaveStatus('Load failed ✗');
    }
  }

  // exporting doc

  function openExportModal() {
    document.getElementById('export-modal').classList.add('open');
    // Reset share link area
    document.getElementById('share-link-area').style.display = 'none';
  }

  function closeExportModal() {
    document.getElementById('export-modal').classList.remove('open');
  }

  /**
   * exports the mindmap SVG as a PNG image file.
   * 
   */
  function exportAsPNG() {
    const svg = document.querySelector('#mindmap svg');
    if (!svg) {
      alert('No mindmap to export. Add some headers first!');
      return;
    }

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = svg.clientWidth || 800;
      canvas.height = svg.clientHeight || 600;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#eef3ff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      const link = document.createElement('a');
      link.download = 'mindmap.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = url;

    closeExportModal();
  }

  /**
   * exports the mindmap tree as a JSON file
   */
  function exportAsJSON() {
    if (!currentTree) {
      alert('No mindmap to export. Add some headers first!');
      return;
    }

    const json = JSON.stringify(MindmapService.serializeTree(currentTree), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = 'mindmap.json';
    link.href = URL.createObjectURL(blob);
    link.click();

    closeExportModal();
  }

  /**
   * Ggenerates a share link for the current doc and displays it
   * saves the doc first if it hasn't been saved yet
   */
  async function generateAndShowShareLink() {
    const editor = tinymce.activeEditor;
    if (!editor) return;

    setSaveStatus('Saving for share...');
    try {
      await saveDocument(editor.getContent());
      if (!currentDocId) throw new Error('No document ID after save');

      const link = FirebaseService.generateShareLink(currentDocId);

      const area = document.getElementById('share-link-area');
      const input = document.getElementById('share-link-input');
      area.style.display = 'block';
      input.value = link;
      input.select();

      setSaveStatus('Saved ✓');
    } catch (err) {
      console.error('[UI] Share link generation failed:', err);
      setSaveStatus('Share failed ✗');
    }
  }

  /**
   * copies share link 2 clipboard
   */
  function copyShareLink() {
    const input = document.getElementById('share-link-input');
    input.select();
    navigator.clipboard.writeText(input.value)
      .then(() => {
        document.getElementById('copy-link-btn').textContent = 'Copied!';
        setTimeout(() => {
          document.getElementById('copy-link-btn').textContent = 'Copy Link';
        }, 2000);
      })
      .catch(() => {
        document.execCommand('copy'); // fallback
      });
  }

  // binding event

  function bindEvents() {
    document.getElementById('save-btn')
      .addEventListener('click', () => {
        const editor = tinymce.activeEditor;
        if (editor) saveDocument(editor.getContent());
      });

    document.getElementById('export-btn')
      .addEventListener('click', openExportModal);

    document.getElementById('modal-close-btn')
      .addEventListener('click', closeExportModal);

    document.getElementById('export-png-btn')
      .addEventListener('click', exportAsPNG);

    document.getElementById('export-json-btn')
      .addEventListener('click', exportAsJSON);

    document.getElementById('export-share-btn')
      .addEventListener('click', generateAndShowShareLink);

    document.getElementById('copy-link-btn')
      .addEventListener('click', copyShareLink);

    // closing modal
    document.getElementById('export-modal')
      .addEventListener('click', (e) => {
        if (e.target === document.getElementById('export-modal')) {
          closeExportModal();
        }
      });
  }

  // public init

  function init() {
    FirebaseService.init();
    bindEvents();
    initEditor();
  }

  return { init };

})();

// app booting
document.addEventListener('DOMContentLoaded', () => UI.init());
