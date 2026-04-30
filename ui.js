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
   * Renders mindmap hierarchy as d3 tree(s) with elliptical nodes
   *
   * @param {Object|null} tree - mindmap tree from MindmapService
   */
  function renderMindmap(tree) {
    const container = document.querySelector('.right-panel');
    const svg_container = resetMindMap();

    if (!tree) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const svg = d3.select(svg_container).append('svg').attr('width', width).attr('height', height);
    const g = svg.append('g');
    enablePanZoom(svg, g);
    
    if (tree.children.length > 1) {
      // Render each h1 tree separately with horizontal spacing
      const treeSpacing = width / (tree.children.length+1);
      let offsetX = treeSpacing;
      
      tree.children.forEach((h1Node, index) => {
        renderTree(g, h1Node, treeSpacing-50, height-100, index, offsetX, 0);
        offsetX += treeSpacing;
      });
    } 
    
    else {
      // Single tree - render normally
      renderTree(g, tree.children[0], width-50, height-100, 0, 0, 0);
    }
  }

  /**
   * Clears the current graph contents and returns the container element.
   * @returns {HTMLElement} The container element used for mind map rendering.
   */
  function resetMindMap() {
    const svg_container = document.getElementById('mindmap');
    d3.select(svg_container).selectAll('*').remove();
    return svg_container;
  }


  /**
   * Enables pan and zoom behavior on the rendered SVG container.
   * @param {d3.Selection} svg - The D3 SVG selection to attach zoom behavior to.
   * @param {d3.Selection} g - The D3 group element whose transform is updated.
   */
  function enablePanZoom(svg, g) {
    svg.call(d3.zoom().on('zoom', (event) => { g.attr('transform', event.transform); }));
  }

  /**
   * Renders a single mind map tree into the provided SVG group.
   * @param {d3.Selection} g - The parent D3 group for this tree.
   * @param {Object} root - The tree data object to render.
   * @param {number} width - The available width for the tree layout.
   * @param {number} height - The available height for the tree layout.
   * @param {number} index - Unique index for the tree section.
   * @param {number} offsetX - Horizontal offset applied to the tree.
   * @param {number} offsetY - Vertical offset applied to the tree.
   */
  function renderTree(g, root, width, height, index, offsetX, offsetY) {
    const tree = d3.hierarchy(root);
    const treeLayout = d3.tree().size([width, height]);
    treeLayout(tree);
    const treeGroup = g.append('g').attr('class', `tree-section-${index}`);
    renderTreeSection(treeGroup, tree, offsetX, offsetY, index);
  }

  /**
   * Renders a tree section with text and node elements.
   * @param {d3.Selection} g - The D3 group element for this tree section.
   * @param {Object} root - The D3 hierarchy root for this section.
   * @param {number} offsetX - Horizontal offset for rendered elements.
   * @param {number} offsetY - Vertical offset for rendered elements.
   * @param {number} sectionIndex - Unique index for this tree section.
   */
  function renderTreeSection(g, root, offsetX, offsetY, sectionIndex) {
    // draw links
    drawTreeLinks(g, root, offsetX, offsetY, sectionIndex)

    // drawing nodes
    const nodes = drawNodes(g, root, offsetX, offsetY, sectionIndex)

    // measure text first, then draw ellipse behind it
    writeTexts(nodes);
    drawTextContainer(nodes);
  }

  /**
   * Draws the connecting links for a tree section.
   * @param {d3.Selection} g - The D3 group element to draw links into.
   * @param {Object} root - The D3 hierarchy root for the tree section.
   * @param {number} offsetX - Horizontal offset to apply to link endpoints.
   * @param {number} offsetY - Vertical offset to apply to link endpoints.
   * @param {number} sectionIndex - Unique index for this tree section.
   */
  function drawTreeLinks(g, root, offsetX, offsetY, sectionIndex) {
    const linkClass = `link-${sectionIndex}`;
     g.selectAll(`line.${linkClass}`)
      .data(root.links())
      .enter()
      .append('line')
      .attr('class', linkClass)
      .attr('x1', d => d.source.x + offsetX)
      .attr('y1', d => d.source.y + offsetY + 50)
      .attr('x2', d => d.target.x + offsetX)
      .attr('y2', d => d.target.y + offsetY + 50)
      .attr('stroke', '#5228a1')
      .attr('stroke-width', 1.5);
  }

  /**
   * Draws the node groups for a tree section.
   * @param {d3.Selection} g - The D3 group element to draw nodes into.
   * @param {Object} root - The D3 hierarchy root for the tree section.
   * @param {number} offsetX - Horizontal offset to apply to node positions.
   * @param {number} offsetY - Vertical offset to apply to node positions.
   * @param {number} sectionIndex - Unique index for this tree section.
   * @returns {d3.Selection} The entered node group selection.
   */
  function drawNodes(g, root, offsetX, offsetY, sectionIndex) {
    const nodeClass = `node-${sectionIndex}`;
    const nodes = g.selectAll(`g.${nodeClass}`)
      .data(root.descendants())
      .enter()
      .append('g')
      .attr('class', nodeClass)
      .attr('transform', d => `translate(${d.x + offsetX}, ${d.y + offsetY + 50})`);
    return nodes;
  }

  /**
   * Appends text labels to each existing node group.
   * @param {d3.Selection} nodes - The node group selection to add text to.
   */
  function writeTexts(nodes) {
    nodes.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', 'white')
      .attr('font-size', d => Math.max(11, 14 - d.depth))
      .text(d => d.data.name)
      .each(function(d) {
        d.textWidth = this.getBBox().width;
      });
  }

  /**
   * Draws the ellipse background for each node after text width is measured.
   * @param {d3.Selection} nodes - The node group selection with text appended.
   */
  function drawTextContainer(nodes) {
    nodes.insert('ellipse', 'text')
      .attr('rx', d => Math.max(40, d.textWidth / 2 + 14))
      .attr('ry', d => Math.max(16, 25 - d.depth * 2))
      .attr('fill', d => {
        // color nodes by depth using the main purple-pink gradient
        const gradient = ['#7b2ff7', '#d83cff', '#f107a3'];
        const t = Math.min(d.depth / 5, 1);
        return d3.interpolateRgbBasis(gradient)(t);
      })
      .attr('stroke', '#5228a1')
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
