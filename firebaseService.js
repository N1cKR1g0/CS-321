/**
 * firebaseService.js
 * PERSISTENCE LAYER — Database Access
 *
 * responsibilities:
 *  - should initialzie Firebase connection
 *  - saves a document (editor content + mindmap snapshot) to Firestore
 *  - loads a document by ID from Firestore
 *  - generates a shareable link for a saved document
 *  - lists recent documents for the current session
 *
 * 
 * 
 *
 * 
 * 
 */

const FirebaseService = (() => {

  // firebase config
  // USING ALBERTS FIREBASE ACCOUNT PROJECT CREDENTIALS
  const firebaseConfig = {
    apiKey: "AIzaSyD1kintGhDeLZu5DnsQL2dwyqm-a-VDohM",
    authDomain: "mindscribe321.firebaseapp.com",
    projectId: "mindscribe321",
    storageBucket: "mindscribe321.firebasestorage.app",
    messagingSenderId: "530725707810",
    appId: "1:530725707810:web:a02349033ec163f62f6a7b"
  };

  // state
  let db = null;
  let isInitialized = false;

  // initialization

  /**
   * initializing firebase and firestore
   * has to be called once before any other method.
   * can be called multiple times
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
   * protects against calling Firebase methods before init().
   */
  function assertReady() {
    if (!isInitialized || !db) {
      throw new Error('[FirebaseService] Not initialized. Call init() first.');
    }
  }

  // document operations

  /**
   * saves a document to the "documents" Firestore collection
   *
   * @param {Object} docData - The document to save
   * @param {string} docData.title       - doc title (first h1 text or default)
   * @param {string} docData.content     - raw HTML from TinyMCE editor
   * @param {Object} docData.mindmapTree - serial. mindmap tree from MindmapService
   * @param {string} [docData.id]        - if pres, updates existing doc; otherwise creates new
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
        // update existing document
        await db.collection('documents').doc(id).set(payload, { merge: true });
        console.log(`[FirebaseService] Document updated: ${id}`);
        return id;
      } else {
        // create new document
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
   * loads a document by its Firestore document ID
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
   * fetches the most recently updated documents for a "recent docs list"
   *
   * @param {number} [limit=10] - max # of docs to return
   * @returns {Promise<Array>} - array of doc objects
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

  // share link

  /**
   * generates a shareable URL for a saved document
   * the URL encodes the document ID as a query parameter so anyone
   * with the link can open and view the mindmap
   *
   * @param {string} docId - the Firestore document ID
   * @returns {string} - full shareable URL
   */
  function generateShareLink(docId) {
    const base = window.location.origin + window.location.pathname;
    return `${base}?doc=${encodeURIComponent(docId)}`;
  }

  /**
   * read the document ID from the current page URL (if present)
   * use on page load to auto-load a shared document
   *
   * @returns {string|null} - Document ID from URL, or null
   */
  function getDocIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('doc') || null;
  }

  //  public API 
  return {
    init,
    saveDocument,
    loadDocument,
    listRecentDocuments,
    generateShareLink,
    getDocIdFromUrl,
  };

})();
