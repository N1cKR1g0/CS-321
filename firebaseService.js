/**
 * firebaseService.js
 * PERSISTENCE LAYER — Database Access
 *
 * Responsibilities:
 *  - Initialize Firebase connection
 *  - Save a document (editor content + mindmap snapshot) to Firestore
 *  - Load a document by ID from Firestore
 *  - Generate a shareable link for a saved document
 *  - List recent documents for the current session
 *
 * This module has NO knowledge of TinyMCE, D3, or UI rendering.
 * It only reads and writes data to/from Firebase.
 *
 * SETUP: Replace the firebaseConfig object below with your own
 * Firebase project credentials from the Firebase Console.
 */

const FirebaseService = (() => {

  // ─── Firebase Configuration ───────────────────────────────────────────────
  // TODO: Replace with your actual Firebase project config
  const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
  };

  // ─── State ────────────────────────────────────────────────────────────────
  let db = null;
  let isInitialized = false;

  // ─── Initialization ───────────────────────────────────────────────────────

  /**
   * Initializes Firebase and Firestore.
   * Must be called once before any other method.
   * Safe to call multiple times (idempotent).
   */
  function init() {
    if (isInitialized) return;

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      db = firebase.firestore();
      isInitialized = true;
      console.log('[FirebaseService] Initialized successfully.');
    } catch (err) {
      console.error('[FirebaseService] Initialization failed:', err);
      throw new Error('Firebase could not be initialized. Check your config.');
    }
  }

  /**
   * Guards against calling Firebase methods before init().
   */
  function assertReady() {
    if (!isInitialized || !db) {
      throw new Error('[FirebaseService] Not initialized. Call init() first.');
    }
  }

  // ─── Document Operations ──────────────────────────────────────────────────

  /**
   * Saves a document to the "documents" Firestore collection.
   *
   * @param {Object} docData - The document to save
   * @param {string} docData.title       - Document title (first h1 text or default)
   * @param {string} docData.content     - Raw HTML from TinyMCE editor
   * @param {Object} docData.mindmapTree - Serialized mindmap tree from MindmapService
   * @param {string} [docData.id]        - If provided, updates existing doc; otherwise creates new
   *
   * @returns {Promise<string>} - The document ID (new or existing)
   */
  async function saveDocument({ title, content, mindmapTree, id = null }) {
    assertReady();

    const payload = {
      title: title || 'Untitled Document',
      content,
      mindmapTree,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    try {
      if (id) {
        // Update existing document
        await db.collection('documents').doc(id).set(payload, { merge: true });
        console.log(`[FirebaseService] Document updated: ${id}`);
        return id;
      } else {
        // Create new document
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        const ref = await db.collection('documents').add(payload);
        console.log(`[FirebaseService] Document created: ${ref.id}`);
        return ref.id;
      }
    } catch (err) {
      console.error('[FirebaseService] Save failed:', err);
      throw err;
    }
  }

  /**
   * Loads a document by its Firestore document ID.
   *
   * @param {string} docId - The Firestore document ID
   * @returns {Promise<Object|null>} - The document data, or null if not found
   */
  async function loadDocument(docId) {
    assertReady();

    try {
      const snap = await db.collection('documents').doc(docId).get();
      if (!snap.exists) {
        console.warn(`[FirebaseService] Document not found: ${docId}`);
        return null;
      }
      return { id: snap.id, ...snap.data() };
    } catch (err) {
      console.error('[FirebaseService] Load failed:', err);
      throw err;
    }
  }

  /**
   * Fetches the most recently updated documents (for a "recent docs" list).
   *
   * @param {number} [limit=10] - Max number of documents to return
   * @returns {Promise<Array>} - Array of document objects
   */
  async function listRecentDocuments(limit = 10) {
    assertReady();

    try {
      const snap = await db.collection('documents')
        .orderBy('updatedAt', 'desc')
        .limit(limit)
        .get();

      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('[FirebaseService] List failed:', err);
      throw err;
    }
  }

  // ─── Share Link ───────────────────────────────────────────────────────────

  /**
   * Generates a shareable URL for a saved document.
   * The URL encodes the document ID as a query parameter so anyone
   * with the link can open and view the mindmap.
   *
   * @param {string} docId - The Firestore document ID
   * @returns {string} - Full shareable URL
   */
  function generateShareLink(docId) {
    const base = window.location.origin + window.location.pathname;
    return `${base}?doc=${encodeURIComponent(docId)}`;
  }

  /**
   * Reads the document ID from the current page URL (if present).
   * Used on page load to auto-load a shared document.
   *
   * @returns {string|null} - Document ID from URL, or null
   */
  function getDocIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('doc') || null;
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  return {
    init,
    saveDocument,
    loadDocument,
    listRecentDocuments,
    generateShareLink,
    getDocIdFromUrl,
  };

})();
