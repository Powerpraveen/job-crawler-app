import React, { useState } from 'react';

// Helper function to parse dates
const parseDate = (dateString) => {
  if (!dateString) return null;
  const parts = dateString.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (parts) {
    const day = parseInt(parts[1], 10);
    const month = parseInt(parts[2], 10) - 1;
    let year = parseInt(parts[3], 10);
    if (year < 100) year += 2000;
    const date = new Date(Date.UTC(year, month, day));
    if (!isNaN(date.getTime())) return date;
  }
  const date = new Date(dateString);
  if (!isNaN(date.getTime())) return date;
  return null;
};

const JOBS_PER_PAGE = 5;

// Main App Component
export default function App() {
  const [url, setUrl] = useState('');
  const [jobs, setJobs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedJob, setCopiedJob] = useState(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const totalPages = Math.ceil(jobs.length / JOBS_PER_PAGE);
  const jobsToShow = jobs.slice((page - 1) * JOBS_PER_PAGE, page * JOBS_PER_PAGE);

  const fetchHtml = async (targetUrl, proxy = true) => {
    const fetchUrl = proxy ? `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}` : targetUrl;
    const response = await fetch(fetchUrl);
    if (!response.ok) throw new Error(`Failed to fetch ${targetUrl}`);
    const data = await response.json();
    return data.contents;
  };

  const handleFetchJobs = async () => {
    if (!url) {
      setError('Please enter a website URL.');
      return;
    }
    setIsLoading(true);
    setError('');
    setJobs([]);
    setCopiedJob(null);
    setPage(1);

    try {
      setStatus('Step 1/3: Fetching main page to find job links...');
      const mainHtml = await fetchHtml(url);
      if (!mainHtml) throw new Error('Could not fetch the main page content.');
      const parser = new DOMParser();
      const mainDoc = parser.parseFromString(mainHtml, 'text/html');
      const postLinks = new Set();
      mainDoc.querySelectorAll('article a, .post a, .job-listing a, h2 a, h3 a').forEach(link => {
        let href = link.href;
        if (href && !href.startsWith('http')) {
          try {
            href = new URL(href, url).href;
          } catch (e) { return; }
        }
        if (href && href.startsWith(new URL(url).origin)) {
          postLinks.add(href);
        }
      });
      const uniqueLinks = Array.from(postLinks);
      if (uniqueLinks.length === 0) throw new Error('Could not find any potential job post links.');
      setStatus(`Step 2/3: Analyzing ${uniqueLinks.length} found links...`);
      const promises = uniqueLinks.map(postUrl => fetchHtml(postUrl).catch(e => { console.warn(`Could not fetch ${postUrl}: ${e.message}`); return null; }));
      const postHtmls = await Promise.all(promises);
      const validHtmls = postHtmls.filter(html => html !== null);
      setStatus(`Step 3/3: Extracting deadlines from ${validHtmls.length} pages...`);
      const foundJobs = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      validHtmls.forEach((postHtml, index) => {
        const postParser = new DOMParser();
        const postDoc = postParser.parseFromString(postHtml, 'text/html');
        const postUrl = uniqueLinks[index];
        const titleElement = postDoc.querySelector('h1, .entry-title');
        const title = titleElement ? titleElement.innerText.trim() : 'Title not found';
        const bodyText = postDoc.body.innerText;
        const deadlineRegex = /(?:last\s+date|closing\s+date|deadline)[\s\S]*?(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i;
        const match = bodyText.match(deadlineRegex);
        if (match && match[1]) {
          const lastDate = parseDate(match[1]);
          if (lastDate && lastDate >= today) {
            if (!foundJobs.some(job => job.link === postUrl)) {
              foundJobs.push({ title, link: postUrl, lastDate });
            }
          }
        }
      });
      if (foundJobs.length === 0) {
        setError('Scan complete. No jobs with future deadlines were found.');
      } else {
        const sortedJobs = foundJobs.sort((a, b) => a.lastDate - b.lastDate);
        setJobs(sortedJobs);
        setPage(1);
      }
    } catch (err) {
      console.error('Operation failed:', err);
      setError(`An error occurred: ${err.message}`);
    } finally {
      setIsLoading(false);
      setStatus('');
    }
  };

  const getWhatsAppLink = (job) => {
    const text = `Post: ${job.title}\nLast date: ${job.lastDate.toLocaleDateString('en-GB')}\nApply Now: ${job.link}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  };

  const handleCopy = (job) => {
    const text = `Post: ${job.title}\nLast date: ${job.lastDate.toLocaleDateString('en-GB')}\nApply Now: ${job.link}`;
    navigator.clipboard.writeText(text);
    setCopiedJob(job.link);
    setTimeout(() => setCopiedJob(null), 2000);
  };
  
  const handleNativeShare = (job) => {
    const text = `Post: ${job.title}\nLast date: ${job.lastDate.toLocaleDateString('en-GB')}\nApply Now: ${job.link}`;
    if (navigator.share) {
      navigator.share({ title: job.title, text: text, url: job.link });
    } else {
      handleCopy(job);
    }
  };

  const goToPrevPage = () => setPage(p => Math.max(1, p - 1));
  const goToNextPage = () => setPage(p => Math.min(totalPages, p + 1));

  return (
    <div className="bg-gray-50 min-h-screen flex items-center justify-center font-sans p-4">
      <div className="w-full max-w-3xl bg-white rounded-xl shadow-lg p-6 md:p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-800">Job Deadline Crawler</h1>
          <p className="text-gray-500 mt-2">Enter a website to find all upcoming job deadlines.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example-job-site.com" className="flex-grow p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition" />
          <button onClick={handleFetchJobs} disabled={isLoading} className="bg-indigo-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed transition shadow-md hover:shadow-lg">
            {isLoading ? 'Crawling...' : 'Start Scan'}
          </button>
        </div>
        {isLoading && <div className="text-center p-4"><div className="flex justify-center items-center mb-3"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div><p className="text-indigo-600 font-semibold">{status}</p></div>}
        {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg text-center" role="alert"><p>{error}</p></div>}
        {jobs.length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-bold text-gray-700 mb-4 border-b pb-2">Upcoming Deadlines Found</h2>
            <ul className="space-y-4">
              {jobsToShow.map((job) => (
                <li key={job.link} className="p-4 bg-gray-50 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 transition hover:bg-gray-100 border-l-4 border-green-500">
                  <div className="flex-grow"><a href={job.link} target="_blank" rel="noopener noreferrer" className="text-lg font-semibold text-indigo-700 hover:underline">{job.title}</a><p className="text-sm font-semibold text-red-600 mt-1">Last Date to Apply: {job.lastDate.toLocaleDateString('en-GB')}</p></div>
                  <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                    <a href={getWhatsAppLink(job)} target="_blank" rel="noopener noreferrer" className="bg-green-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-green-600 transition text-sm" title="Share via WhatsApp">WhatsApp</a>
                    <button onClick={() => handleCopy(job)} className="bg-teal-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-teal-600 transition text-sm" title="Copy formatted message">{copiedJob === job.link ? 'Copied!' : 'Copy'}</button>
                    <button onClick={() => handleNativeShare(job)} className="bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-600 transition text-sm" title="Share with device">Share</button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex justify-between mt-6 items-center">
              <button disabled={page === 1} onClick={goToPrevPage} className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50">Previous</button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={page === totalPages} onClick={goToNextPage} className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
