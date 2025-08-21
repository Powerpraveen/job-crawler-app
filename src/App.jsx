import React, { useState } from 'react';

// Advanced Date Parsing (No changes needed here)
const parseDate = (dateString) => {
    if (!dateString) return null;
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    let parts = dateString.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (parts) {
        const day = parseInt(parts[1], 10);
        const month = parseInt(parts[2], 10) - 1;
        let year = parseInt(parts[3], 10);
        if (year < 100) year += 2000;
        const date = new Date(Date.UTC(year, month, day));
        if (!isNaN(date.getTime())) return date;
    }
    parts = dateString.replace(/, /g, ' ').match(/(?:(\d{1,2}) )?([a-z]{3,}) (\d{1,2})?(?:, )?(\d{4})/i);
    if (parts) {
        const monthStr = parts[2].substring(0, 3).toLowerCase();
        if (months[monthStr] !== undefined) {
            const day = parseInt(parts[1] || parts[3], 10);
            const month = months[monthStr];
            const year = parseInt(parts[4], 10);
            const date = new Date(Date.UTC(year, month, day));
            if (!isNaN(date.getTime())) return date;
        }
    }
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) return date;
    return null;
};


const JOBS_PER_PAGE = 10;

// Main App Component
export default function App() {
    const [url, setUrl] = useState('');
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [copiedJob, setCopiedJob] = useState(null);
    const [status, setStatus] = useState('');
    const [page, setPage] = useState(1);
    // --- NEW: State for the optional last date filter ---
    const [filterDate, setFilterDate] = useState('');

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
        let correctedUrl = url.trim();
        if (!correctedUrl.startsWith('http://') && !correctedUrl.startsWith('https://')) {
            correctedUrl = `https://${correctedUrl}`;
        }
        setIsLoading(true);
        setError('');
        setJobs([]);
        setCopiedJob(null);
        setPage(1);

        try {
            setStatus('Step 1/3: Fetching main page to find job links...');
            const mainHtml = await fetchHtml(correctedUrl);
            if (!mainHtml) throw new Error('Could not fetch the main page content.');
            const parser = new DOMParser();
            const mainDoc = parser.parseFromString(mainHtml, 'text/html');
            const postLinks = new Set();
            const jobUrlKeywords = ['job', 'career', 'vacancy', 'hiring', 'position'];
            mainDoc.querySelectorAll('article a, .post a, .job-listing a, h2 a, h3 a').forEach(link => {
                let href = link.href;
                if (href && !href.startsWith('http')) {
                    try { href = new URL(href, correctedUrl).href; } catch (e) { return; }
                }
                if (href && href.startsWith(new URL(correctedUrl).origin)) {
                    const linkText = link.innerText.toLowerCase();
                    const linkUrl = href.toLowerCase();
                    if (jobUrlKeywords.some(keyword => linkUrl.includes(keyword) || linkText.includes(keyword))) {
                       postLinks.add(href);
                    }
                }
            });

            const uniqueLinks = Array.from(postLinks);
            if (uniqueLinks.length === 0) throw new Error('Could not find any potential job post links. Try a more specific URL.');

            setStatus(`Step 2/3: Analyzing ${uniqueLinks.length} found links...`);
            const promises = uniqueLinks.map(link =>
                fetchHtml(link)
                    .then(html => ({ url: link, html }))
                    .catch(e => {
                        console.warn(`Could not fetch ${link}: ${e.message}`);
                        return { url: link, html: null };
                    })
            );

            const results = await Promise.all(promises);
            const validResults = results.filter(result => result.html !== null);
           
            setStatus(`Step 3/3: Verifying posts and extracting deadlines...`);
            const foundJobs = [];
            const today = new Date();
            today.setHours(0, 0, 0, 0);
           
            const findTitle = (doc) => {
                const structuralSelectors = [
                    'h1.entry-title', 'h2.entry-title', 'h1.post-title', 'h2.post-title',
                    'article h1', 'main h1', '.entry-content h1', 'article h2', 'main h2',
                    '.entry-content h2', '.entry-title', '.post-title'
                ];
                for (const selector of structuralSelectors) {
                    const element = doc.querySelector(selector);
                    if (element) {
                        const titleText = element.innerText.trim();
                        if (titleText.includes(' ')) return titleText;
                    }
                }
                const firstH1 = doc.querySelector('h1');
                if (firstH1) return firstH1.innerText.trim();
                return 'Post Title Not Found';
            };

            validResults.forEach(result => {
                const { url: postUrl, html: postHtml } = result;
                const postParser = new DOMParser();
                const postDoc = postParser.parseFromString(postHtml, 'text/html');
               
                const title = findTitle(postDoc);
                const bodyText = postDoc.body.innerText;
                const deadlineRegex = /(?:last date|closing date|deadline|apply by|applications close|submit by)[\s:.-]*([\w\s,./-]+\d{1,4})/i;
                const match = bodyText.match(deadlineRegex);

                if (match && match[1]) {
                    const jobKeywords = ['qualification', 'responsibilit', 'experience', 'salary', 'location', 'apply now', 'job type'];
                    let score = 0;
                    const lowerBodyText = bodyText.toLowerCase();
                    jobKeywords.forEach(keyword => {
                        if (lowerBodyText.includes(keyword)) score++;
                    });
                    if (score >= 2) {
                        const lastDate = parseDate(match[1].trim());
                        if (lastDate && lastDate >= today) {
                            if (!foundJobs.some(job => job.link === postUrl)) {
                                foundJobs.push({ title, link: postUrl, lastDate });
                            }
                        }
                    }
                }
            });

            // --- NEW: Filter jobs based on the selected date before setting state ---
            // --- NEW: Smart filter with fallback for nearest date ---
            let finalJobs = foundJobs;
            if (filterDate) {
                // Step 1: First, try to find an exact match for the selected date.
                const exactMatchJobs = foundJobs.filter(job => {
                    const jobDateString = job.lastDate.toISOString().split('T')[0];
                    return jobDateString === filterDate;
                });

                // Step 2: If exact matches are found, use them.
                if (exactMatchJobs.length > 0) {
                    finalJobs = exactMatchJobs;
                } else {
                    // Step 3: If no exact match, find the nearest available date BEFORE the selected one.
                    const selectedDate = new Date(filterDate);
                    
                    // Get all jobs with deadlines on or before the selected date.
                    const candidateJobs = foundJobs.filter(job => job.lastDate <= selectedDate);

                    if (candidateJobs.length > 0) {
                        // Find the latest date among these candidates by sorting descending.
                        const nearestDate = candidateJobs.sort((a, b) => b.lastDate - a.lastDate)[0].lastDate;
                        
                        // Now, get all jobs that match this single "nearest" date.
                        finalJobs = candidateJobs.filter(job => job.lastDate.getTime() === nearestDate.getTime());
                    } else {
                        // If no jobs exist on or before the selected date, the result is empty.
                        finalJobs = [];
                    }
                }
            }

    // --- No changes needed in helper functions below ---
    const generateShareText = (job) => {
        return `📄 *Post name:* ${job.title}\n\n📅 *Last date:* ${job.lastDate.toLocaleDateString('en-GB')}\n\n🔗 *Apply Link:*\n${job.link}`;
    };

    const getWhatsAppLink = (job) => {
        const text = generateShareText(job);
        return `https://wa.me/?text=${encodeURIComponent(text)}`;
    };

    const handleCopy = (job) => {
        const text = generateShareText(job);
        navigator.clipboard.writeText(text);
        setCopiedJob(job.link);
        setTimeout(() => setCopiedJob(null), 2000);
    };
   
    const handleNativeShare = (job) => {
        const text = generateShareText(job);
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
                {/* --- MODIFIED: Input section to include date picker --- */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
                     <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="newgovtjobalert.com" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition" />
                     <div>
                        <label htmlFor="filter-date" className="text-sm font-medium text-gray-600">Optional: Find jobs with deadline on or before</label>
                        <input id="filter-date" type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition" />
                     </div>
                </div>
                <div className="flex justify-end mb-4">
                     <button onClick={handleFetchJobs} disabled={isLoading} className="w-full sm:w-auto bg-indigo-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed transition shadow-md hover:shadow-lg">
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

