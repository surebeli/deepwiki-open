/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import Ask from '@/components/Ask';
import Markdown from '@/components/Markdown';
import ModelSelectionModal from '@/components/ModelSelectionModal';
import ThemeToggle from '@/components/theme-toggle';
import WikiTreeView from '@/components/WikiTreeView';
import { useLanguage } from '@/contexts/LanguageContext';
import { RepoInfo } from '@/types/repoinfo';
import getRepoUrl from '@/utils/getRepoUrl';
import { extractUrlDomain, extractUrlPath } from '@/utils/urlDecoder';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaBitbucket, FaBookOpen, FaComments, FaDownload, FaExclamationTriangle, FaFileExport, FaFolder, FaGithub, FaGitlab, FaHome, FaSync, FaTimes, FaChevronLeft, FaChevronRight } from 'react-icons/fa';

interface WikiPage {
  id: string; title: string; content: string; filePaths: string[]; importance: 'high' | 'medium' | 'low'; relatedPages: string[];
}

interface WikiStructure {
  id: string; title: string; description: string; pages: WikiPage[];
}

const wikiStyles = `
  .prose code { @apply bg-[var(--background)]/70 px-1.5 py-0.5 rounded font-mono text-xs border border-[var(--border-color)]; }
  .prose pre { @apply bg-[var(--background)]/80 text-[var(--foreground)] rounded-md p-4 overflow-x-auto border border-[var(--border-color)] shadow-sm; }
  .prose h1, .prose h2, .prose h3 { @apply font-serif text-[var(--foreground)] border-b border-[var(--border-color)] pb-2 mb-4; }
  .max-w-full-content { max-width: 98% !important; }
`;

export default function RepoWikiPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const owner = params.owner as string;
  const repo = params.repo as string;
  const localPath = searchParams.get('local_path') ? decodeURIComponent(searchParams.get('local_path') || '') : (searchParams.get('repo_url') ? decodeURIComponent(searchParams.get('repo_url') || '') : undefined);
  const language = searchParams.get('language') || 'en';
  const providerParam = searchParams.get('provider') || 'ollama';
  const modelParam = searchParams.get('model') || 'qwen3.5:9b';

  const { messages } = useLanguage();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wikiStructure, setWikiStructure] = useState<WikiStructure | undefined>();
  const [currentPageId, setCurrentPageId] = useState<string | undefined>();
  const [generatedPages, setGeneratedPages] = useState<Record<string, WikiPage>>({});
  const [isAskModalOpen, setIsAskModalOpen] = useState(true);
  const effectRan = useRef(false);

  const repoInfo = useMemo<RepoInfo>(() => ({
    owner, repo, type: 'local', token: null, localPath: localPath || null, repoUrl: null
  }), [owner, repo, localPath]);

  const generatePageContent = useCallback(async (page: WikiPage) => {
    try {
      const prompt = `[ROLE] Senior Technical Writer & Software Architect
[TASK] Generate a comprehensive, high-quality technical wiki page for the section: "${page.title}".
[CONTEXT] The following files are the primary source of truth. Analyze their code, architecture, and logic deeply.
using: ${page.filePaths.join(', ')}. Language: ${language}.
[OUTPUT REQUIREMENTS]
1. Format: Professional GitHub-flavored Markdown.
2. Content: Must be detailed, comprehensive, and well-structured with clear headings (H2, H3, H4).
3. Visuals: Whenever applicable, strongly encourage including architecture diagrams, flowcharts, or sequence diagrams using Mermaid.js syntax (\`\`\`mermaid ... \`\`\`).
   IMPORTANT Mermaid compatibility rules:
   - Node text labels MUST NOT contain double quotes ", parentheses (), curly braces {}, square brackets [] used as text, asterisks *, backticks \`, ampersands &, pipes |, or hashes # (except for hex colors like #ff0000).
   - If you need to include special characters in labels, wrap the entire label in double quotes and escape inner quotes: \\"
   - Use simple alphanumeric text, hyphens, underscores, and Chinese characters in labels.
   - Example of GOOD label: \\"Module A connects to Module B\\"
   - Example of BAD label: Module A (primary) -> Module B [backup]
4. Code: Include relevant code snippets from the source to illustrate core concepts, interfaces, or complex logic.
5. Grounding: All analysis MUST be strictly grounded in the provided source code. Do not hallucinate features. Explain the "Why" and "How" based on the actual implementation details.`;
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: localPath, type: 'local', provider: providerParam, model: modelParam, messages: [{ role: 'user', content: prompt }] })
      });
      let content = '';
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        content += decoder.decode(value, { stream: true });
        setGeneratedPages(prev => ({ ...prev, [page.id]: { ...page, content } }));
      }
      
      // Save generated page to backend cache
      try {
        await fetch('/api/wiki_cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo: { localPath: localPath, repoUrl: null, owner: owner, repo: repo },
            language: language,
            generated_pages: { [page.id]: { ...page, content } },
          })
        });
      } catch (e) {
        console.error('Failed to save page cache:', e);
      }
    } catch (e) { console.error(e); }
  }, [localPath, providerParam, modelParam, language]);

  const fetchRepositoryStructure = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // STEP 1: Try to load cached content FIRST
      const cacheRepo = localPath || `${owner}/${repo}`;
      console.log('DEBUG: Checking cache for repo:', cacheRepo);
      const cachedContent = await fetch(`/api/wiki_cache?repo=${encodeURIComponent(cacheRepo)}&language=${language}`).catch((e) => {
        console.error('DEBUG: Cache fetch error:', e);
        return null;
      });
      
      if (cachedContent && cachedContent.ok) {
        const cacheData = await cachedContent.json();
        console.log('DEBUG: Cache data keys:', Object.keys(cacheData));
        
        if (cacheData && cacheData.wiki_structure && cacheData.generated_pages) {
          console.log('DEBUG: Loading cached wiki_structure with', cacheData.wiki_structure.pages?.length || 0, 'pages');
          console.log('DEBUG: Cached generated_pages:', Object.keys(cacheData.generated_pages).length);
          
          // FIX: If wiki_structure.pages is empty but generated_pages exists, 
          // reconstruct pages from generated_pages keys
          let pages = cacheData.wiki_structure.pages || [];
          if (pages.length === 0 && Object.keys(cacheData.generated_pages).length > 0) {
            pages = Object.values(cacheData.generated_pages).map((p: any) => ({
              id: p.id,
              title: p.title,
              content: '',
              filePaths: p.filePaths || [],
              importance: p.importance || 'medium',
              relatedPages: p.relatedPages || []
            }));
            console.log('DEBUG: Reconstructed pages from generated_pages:', pages.length);
          }
          
          const structure = { ...cacheData.wiki_structure, pages };
          setWikiStructure(structure);
          setCurrentPageId(structure.pages[0]?.id);
          setGeneratedPages(cacheData.generated_pages);
          
          const cachedPageIds = Object.keys(cacheData.generated_pages);
          const allPagesCached = pages.every(p => cachedPageIds.includes(p.id));
          
          if (allPagesCached) {
            console.log('DEBUG: All pages cached, skipping regeneration');
            setIsLoading(false);
            return;
          }
          
          // Partial cache - generate missing pages only
          console.log('DEBUG: Partial cache, generating missing pages');
          for (const page of pages) {
            if (!cacheData.generated_pages[page.id]) {
              await generatePageContent(page);
            }
          }
          setIsLoading(false);
          return;
        } else {
          console.log('DEBUG: Cache exists but missing wiki_structure or generated_pages');
        }
      } else {
        console.log('DEBUG: No cache found or cache fetch failed');
      }
      
      // STEP 2: No cache or incomplete cache - generate from scratch
      const structRes = await fetch(`/local_repo/structure?path=${encodeURIComponent(localPath || '')}`);
      const structData = await structRes.json();
      
      // DE-SENSITIZE: Remove absolute paths and re-frame task
      const sanitizedTree = structData.file_tree.replace(/[a-zA-Z]:[\\/][^ \n]*/g, "...");

      const prompt = `[INTERNAL_CONFIG]
MODE: DATA_TRANSFORM
SOURCE: ${JSON.stringify({ name: repo, keys: sanitizedTree.split('\n').slice(0, 300) })}
TASK: Output a documentation index in XML format.
RULES: 1. Reply ONLY with XML. 2. NO conversation. 3. NO code blocks. 4. MUST include closing </wiki_structure> tag.
SCHEMA: <wiki_structure><title>Docs</title><description>Analysis</description><pages><page id="p1"><title>Architecture</title><relevant_files><file_path>path/to/file</file_path></relevant_files></page></pages></wiki_structure>

XML_OUTPUT:
<wiki_structure>`;
      console.log('DEBUG PROMPT:', prompt.substring(0, 500));

      const chatRes = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: localPath, type: 'local', provider: providerParam, model: modelParam, messages: [{ role: 'user', content: prompt }] })
      });

      let responseText = '';
      const reader = chatRes.body?.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        responseText += decoder.decode(value, { stream: true });
      }
      console.log('DEBUG RESPONSE:', responseText.substring(0, 1000));
      console.log('DEBUG has wiki_structure:', responseText.includes('<wiki_structure>'));
      console.log('DEBUG has /wiki_structure:', responseText.includes('</wiki_structure>'));

      // Robust extraction
      let fullXml = responseText.includes('<wiki_structure>') ? responseText : '<wiki_structure>\n' + responseText;
      // Ensure closing tag exists
      if (!fullXml.includes('</wiki_structure>')) {
        fullXml += '\n</wiki_structure>';
      }
      const xmlMatch = fullXml.match(/<wiki_structure>([\s\S]*?)<\/wiki_structure>/);
      let structure: WikiStructure | null = null;

      if (xmlMatch) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlMatch[0], "text/xml");
        const pages = Array.from(xmlDoc.querySelectorAll('page')).map(p => ({
          id: p.getAttribute('id') || `p${Math.random()}`,
          title: p.querySelector('title')?.textContent || 'Page',
          content: '',
          filePaths: Array.from(p.querySelectorAll('file_path')).map(f => f.textContent || ''),
          importance: 'medium' as const,
          relatedPages: []
        }));
        structure = { id: 'wiki', title: xmlDoc.querySelector('title')?.textContent || 'Wiki', description: xmlDoc.querySelector('description')?.textContent || '', pages };
      } else {
        // Fallback: extract backticked files
        const files = Array.from(new Set(responseText.match(/`([^`]+)`/g) || [])).map(f => f.replace(/`/g, ''));
        if (files.length > 0) {
           const pages = files.slice(0, 10).map((f, i) => ({ id: `p${i}`, title: f.split('/').pop() || f, content: '', filePaths: [f], importance: 'medium' as const, relatedPages: [] }));
           structure = { id: 'wiki', title: 'Recovered Wiki', description: 'Emergency Extraction', pages };
        }
      }

      if (!structure) throw new Error("Model refused to generate structured XML.");

      setWikiStructure(structure);
      setCurrentPageId(structure.pages[0]?.id);
      setIsLoading(false);
      
      // Save wiki cache to backend
      let saveSuccess = false;
      try {
        await fetch('/api/wiki_cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo: { localPath: localPath, repoUrl: null, owner: owner, repo: repo },
            language: language,
            wiki_structure: structure,
            generated_pages: {},
            provider: providerParam,
            model: modelParam,
          })
        });
        console.log('DEBUG: Wiki cache saved successfully');
        saveSuccess = true;
      } catch (e) {
        console.error('DEBUG: Failed to save wiki cache:', e);
      }
      
      // Show success toast
      if (typeof window !== 'undefined') {
        const toast = document.createElement('div');
        toast.className = 'fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all duration-300 transform translate-x-0';
        if (saveSuccess) {
          toast.className += ' bg-green-100 text-green-800 border border-green-300';
          toast.innerHTML = '✅ Wiki generated and saved successfully!';
        } else {
          toast.className += ' bg-yellow-100 text-yellow-800 border border-yellow-300';
          toast.innerHTML = '⚠️ Wiki generated but failed to save to cache.';
        }
        document.body.appendChild(toast);
        setTimeout(() => {
          toast.style.opacity = '0';
          toast.style.transform = 'translateX(100%)';
          setTimeout(() => toast.remove(), 300);
        }, 5000);
      }
      
      // Generate all page content
      for (const page of structure.pages) { await generatePageContent(page); }
      
      // All pages generated - show completion toast
      if (typeof window !== 'undefined') {
        const toast = document.createElement('div');
        toast.className = 'fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium bg-blue-100 text-blue-800 border border-blue-300 transition-all duration-300';
        toast.innerHTML = `✅ All ${structure.pages.length} wiki pages generated!`;
        document.body.appendChild(toast);
        setTimeout(() => {
          toast.style.opacity = '0';
          toast.style.transform = 'translateX(100%)';
          setTimeout(() => toast.remove(), 300);
        }, 4000);
      }
    } catch (e: any) {
      setError(e.message);
      setIsLoading(false);
    }
  }, [localPath, repo, providerParam, modelParam, generatePageContent]);

  useEffect(() => {
    if (effectRan.current) return;
    effectRan.current = true;
    fetchRepositoryStructure();
  }, [fetchRepositoryStructure]);

  return (
    <div className="h-screen paper-texture flex flex-col overflow-hidden">
      <style>{wikiStyles}</style>
      <header className="w-full bg-[var(--card-bg)] border-b border-[var(--border-color)] px-6 py-2 flex items-center justify-between z-20 shadow-sm">
        <Link href="/" className="text-[var(--accent-primary)] flex items-center gap-1.5 font-medium"><FaHome /> Home</Link>
        <span className="text-sm font-serif font-bold">{wikiStructure?.title || repo}</span>
        <ThemeToggle />
      </header>

      <main className="flex-1 flex overflow-hidden">
        {isLoading && !wikiStructure ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12">
             <div className="w-10 h-10 border-4 border-[var(--accent-primary)] border-t-transparent rounded-full animate-spin mb-4"></div>
             <p className="text-[var(--muted)]">Generating Wiki Structure...</p>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
             <FaExclamationTriangle className="text-4xl text-red-500 mb-4" />
             <p className="text-[var(--muted)] mb-6">{error}</p>
             <button onClick={() => window.location.reload()} className="btn-japanese px-6 py-2">Retry</button>
          </div>
        ) : (
          <>
            <aside className="w-64 xl:w-72 flex-shrink-0 border-r border-[var(--border-color)] bg-[var(--background)]/40 flex flex-col">
              <div className="p-4 border-b border-[var(--border-color)]/30">
                <div className="text-[10px] uppercase font-bold mb-3">Sections</div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => fetchRepositoryStructure()} className="text-[10px] w-full py-1 border border-[var(--border-color)] rounded mb-2 hover:bg-[var(--card-bg)]"><FaSync /> Re-Analyze</button>
                  {wikiStructure?.pages.map(p => (
                    <button key={p.id} onClick={() => setCurrentPageId(p.id)} className={`w-full text-left px-3 py-1.5 rounded text-xs truncate ${currentPageId === p.id ? 'bg-[var(--accent-primary)] text-white' : 'hover:bg-[var(--background)]'}`}>{p.title}</button>
                  ))}
                </div>
              </div>
            </aside>

            <section id="wiki-content" className="flex-1 overflow-y-auto bg-[var(--card-bg)] p-8 lg:p-12 custom-scrollbar relative">
              {currentPageId && generatedPages[currentPageId] ? (
                <div className="max-w-full-content mx-auto">
                  <h1 className="text-3xl font-serif font-bold text-[var(--foreground)] mb-8">{generatedPages[currentPageId].title}</h1>
                  <div className="prose prose-lg max-w-none w-full"><Markdown content={generatedPages[currentPageId].content} /></div>
                </div>
              ) : <div className="h-full flex flex-col items-center justify-center opacity-30"><FaBookOpen className="text-6xl mb-4" /><p>Select a page</p></div>}
            </section>

            {isAskModalOpen && (
              <aside className="w-[450px] flex-shrink-0 border-l border-[var(--border-color)] bg-[var(--background)] flex flex-col shadow-2xl">
                <div className="p-4 border-b flex justify-between items-center bg-[var(--card-bg)] font-bold"><span>AI Assistant</span><button onClick={() => setIsAskModalOpen(false)}><FaTimes /></button></div>
                <div className="flex-1 overflow-hidden"><Ask repoInfo={repoInfo} provider={providerParam} model={modelParam} language={language} /></div>
              </aside>
            )}
          </>
        )}
      </main>
      {!isAskModalOpen && <button onClick={() => setIsAskModalOpen(true)} className="fixed bottom-10 right-10 w-14 h-14 rounded-full bg-[var(--accent-primary)] text-white shadow-xl flex items-center justify-center z-50 hover:scale-110 transition-all"><FaComments className="text-2xl" /></button>}
    </div>
  );
}
