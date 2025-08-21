import React, { useState, useEffect, useReducer } from 'react';
import { createPortal } from 'react-dom';

// --- Utility Functions ---

/**
 * Parses a date string into a Date object.
 * Supports various formats (dd/mm/yyyy, mm dd, yyyy, etc.).
 * @param {string} dateString - The date string to parse.
 * @returns {Date|null} The parsed Date object or null if invalid.
 */
const parseDate = (dateString) => {
    if (!dateString) return null;
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    
    // Pattern 1: dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
    let parts = dateString.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (parts) {
        const day = parseInt(parts[1], 10);
        const month = parseInt(parts[2], 10) - 1;
        let year = parseInt(parts[3], 10);
        if (year < 100) year += 2000;
        const date = new Date(Date.UTC(year, month, day));
        if (!isNaN(date.getTime())) return date;
    }
    
    // Pattern 2: Month dd, yyyy or dd Month yyyy
    parts = dateString.replace(/, /g, ' ').match(/(?:(\d{1,2}) )?([a-z]{3,}) (\d{1,2})?(?:, )?(\d{4})/i);
    if (parts) {
        const monthStr = parts[2]?.substring(0, 3)?.toLowerCase();
        if (months[monthStr] !== undefined) {
            const day = parseInt(parts[1] || parts[3], 10);
            const month = months[monthStr];
            const year = parseInt(parts[4], 10);
            const date = new Date(Date.UTC(year, month, day));
            if (!isNaN(date.getTime())) return date;
        }
    }
    
    // Pattern 3: yyyy-mm-dd
    parts = dateString.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    if (parts) {
        const year = parseInt(parts[1], 10);
        const month = parseInt(parts[2], 10) - 1;
        const day = parseInt(parts[3], 10);
        const date = new Date(Date.UTC(year, month, day));
        if (!isNaN(date.getTime())) return date;
    }
    
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) return date;
    return null;
};

/**
 * Generates a formatted string for sharing a job post.
 * @param {object} job - The job object.
 * @returns {string} The formatted share text.
 */
const generateShareText = (job) => {
    return `📄 *Post name:* ${job.title}\n\n📅 *Last date:* ${job.lastDate.toLocaleDateString('en-GB')}\n\n🔗 *Apply Link:*\n${job.link}`;
};

// --- Custom Hook for Crawler Logic ---

const crawlerReducer = (state, action) => {
    switch (action.type) {
        case 'START_SCAN':
            return {
                ...state,
                isLoading: true,
                status: 'Step 1/3: Fetching main page to find job links...',
                jobs: [],
                error: '',
                page: 1,
            };
        case 'UPDATE_STATUS':
            return {
                ...state,
                status: action.payload,
            };
        case 'SET_JOBS':
            return {
                ...state,
                jobs: action.payload,
                isLoading: false,
                status: '',
            };
        case 'SET_ERROR':
            return {
                ...state,
                error: action.payload,
                isLoading: false,
                status: '',
            };
        case 'SET_PAGE':
            return {
                ...state,
                page: action.payload,
            };
        case 'SET_URL':
            return {
                ...state,
                url: action.payload,
            };
        case 'SET_FILTER_DATE':
            return {
                ...state,
                filterDate: action.payload,
            };
        case 'TOGGLE_SIX_MONTHS_FILTER':
            return {
                ...state,
                showNextSixMonths: action.payload,
            };
        default:
            return state;
    }
};

/**
 * Custom hook to handle all job crawling logic.
 */
const useJobCrawler = () => {
    const [state, dispatch] = useReducer(crawlerReducer, {
        url: '',
        jobs: [],
        isLoading: false,
        status: '',
        error: '',
        page: 1,
        filterDate: '',
        showNextSixMonths: false,
    });

    /**
     * Fetches HTML content from a given URL using an API proxy.
     * @param {string} targetUrl - The URL to fetch.
     * @returns {Promise<string>} The HTML content as a string.
     */
    const fetchHtml = async (targetUrl) => {
        const fetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error(`Failed to fetch ${targetUrl}`);
        const data = await response.json();
        return data.contents;
    };

    /**
     * Core function to fetch and parse jobs from the given URL.
     */
    const handleFetchJobs = async () => {
        if (!state.url) {
            dispatch({ type: 'SET_ERROR', payload: 'Please enter a website URL.' });
            return;
        }

        dispatch({ type: 'START_SCAN' });
        let correctedUrl = state.url.trim();
        if (!correctedUrl.startsWith('http://') && !correctedUrl.startsWith('https://')) {
            correctedUrl = `https://${correctedUrl}`;
        }

        try {
            // Step 1: Fetch and parse the main page to find potential job links
            const mainHtml = await fetchHtml(correctedUrl);
            if (!mainHtml) throw new Error('Could not fetch the main page content.');
            const mainDoc = new DOMParser().parseFromString(mainHtml, 'text/html');

            const postLinks = new Set();
            const jobUrlKeywords = ['job', 'career', 'vacancy', 'hiring', 'position'];
            mainDoc.querySelectorAll('article a, .post a, .job-listing a, h2 a, h3 a').forEach(link => {
                let href = link.href;
                if (href && !href.startsWith('http')) {
                    try { href = new URL(href, correctedUrl).href; } catch (e) { return; }
                }
                if (href && href.startsWith(new URL(correctedUrl).origin)) {
                    const linkText = link.innerText?.toLowerCase() || '';
                    const linkUrl = href.toLowerCase();
                    if (jobUrlKeywords.some(keyword => linkUrl.includes(keyword) || linkText.includes(keyword))) {
                       postLinks.add(href);
                    }
                }
            });

            const uniqueLinks = Array.from(postLinks);
            if (uniqueLinks.length === 0) throw new Error('Could not find any potential job post links. Try a more specific URL.');

            dispatch({ type: 'UPDATE_STATUS', payload: `Step 2/3: Analyzing ${uniqueLinks.length} found links...` });

            // Step 2: Fetch and parse each job link concurrently
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

            dispatch({ type: 'UPDATE_STATUS', payload: `Step 3/3: Verifying posts and extracting deadlines...` });

            // Step 3: Extract job details and filter
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
                        const titleText = element.innerText?.trim();
                        if (titleText?.length > 10) return titleText;
                    }
                }
                const firstH1 = doc.querySelector('h1');
                if (firstH1) return firstH1.innerText?.trim();
                return 'Post Title Not Found';
            };

            validResults.forEach(result => {
                const { url: postUrl, html: postHtml } = result;
                const postDoc = new DOMParser().parseFromString(postHtml, 'text/html');

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
                        const lastDate = parseDate(match[1]?.trim());
                        if (lastDate && lastDate >= today) {
                            if (!foundJobs.some(job => job.link === postUrl)) {
                                foundJobs.push({ title, link: postUrl, lastDate });
                            }
                        }
                    }
                }
            });

            // Sort jobs by deadline date
            foundJobs.sort((a, b) => a.lastDate.getTime() - b.lastDate.getTime());

            dispatch({ type: 'SET_JOBS', payload: foundJobs });

        } catch (e) {
            console.error('An error occurred during the scan:', e);
            dispatch({ type: 'SET_ERROR', payload: e.message || 'An unexpected error occurred. Please check the URL and try again.' });
        }
    };

    // Corrected action dispatch for setUrl
    const setUrl = (newUrl) => dispatch({ type: 'SET_URL', payload: newUrl });
    const setFilterDate = (newDate) => dispatch({ type: 'SET_FILTER_DATE', payload: newDate });
    const setPage = (newPage) => dispatch({ type: 'SET_PAGE', payload: newPage });
    const toggleSixMonths = (checked) => dispatch({ type: 'TOGGLE_SIX_MONTHS_FILTER', payload: checked });

    return { ...state, setUrl, setFilterDate, setPage, handleFetchJobs, toggleSixMonths };
};

// --- App Component ---

const JOBS_PER_PAGE = 10;

export default function App() {
    const { jobs, isLoading, status, error, page, url, filterDate, showNextSixMonths, setUrl, setFilterDate, setPage, handleFetchJobs, toggleSixMonths } = useJobCrawler();
    const [copiedJob, setCopiedJob] = useState(null);

    // Apply filters based on user selection
    const filteredJobs = jobs.filter(job => {
        const deadline = job.lastDate;
        if (filterDate) {
            return deadline <= new Date(filterDate);
        }
        if (showNextSixMonths) {
            const sixMonthsFromNow = new Date();
            sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
            return deadline <= sixMonthsFromNow;
        }
        return true; // No filter applied
    });

    const totalPages = Math.ceil(filteredJobs.length / JOBS_PER_PAGE);
    const jobsToShow = filteredJobs.slice((page - 1) * JOBS_PER_PAGE, page * JOBS_PER_PAGE);

    const getWhatsAppLink = (job) => {
        const text = generateShareText(job);
        return `https://wa.me/?text=${encodeURIComponent(text)}`;
    };

    const handleCopy = (job) => {
        const text = generateShareText(job);
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                setCopiedJob(job.link);
                setTimeout(() => setCopiedJob(null), 2000);
            }).catch(err => {
                console.error('Could not copy text: ', err);
            });
        } else {
            // Fallback for environments where clipboard API is not available (like iframes)
            const el = document.createElement('textarea');
            el.value = text;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            setCopiedJob(job.link);
            setTimeout(() => setCopiedJob(null), 2000);
        }
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
    
    // Simple Modal for errors
    const ErrorModal = ({ message, onClose }) => {
        return createPortal(
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex justify-center items-center z-50" onClick={onClose}>
                <div className="relative p-6 bg-white w-96 rounded-lg shadow-xl animate-fade-in-up" onClick={e => e.stopPropagation()}>
                    <h3 className="text-xl font-semibold text-red-700 mb-2 flex items-center">
                        <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        Error
                    </h3>
                    <p className="text-gray-600 mb-4">{message}</p>
                    <div className="flex justify-end">
                        <button onClick={onClose} className="px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition">
                            Close
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        );
    };

    return (
        <div className="bg-slate-100 min-h-screen flex items-center justify-center font-sans p-4">
            <style>
                {`
                    @keyframes spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                    .animate-spin-slow {
                        animation: spin 2s linear infinite;
                    }
                    @keyframes fadeInUp {
                        from { opacity: 0; transform: translateY(20px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    .animate-fade-in-up {
                        animation: fadeInUp 0.5s ease-out;
                    }
                `}
            </style>
            {error && <ErrorModal message={error} onClose={() => setPage(1)} />}
            <div className="w-full max-w-3xl bg-white rounded-xl shadow-2xl p-6 md:p-8 border border-gray-200">
                <div className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-extrabold text-gray-800">Job Deadline <span className="text-indigo-600">Crawler</span></h1>
                    <p className="text-gray-500 mt-2 text-lg">Enter a website to find all upcoming job deadlines.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <input
                        type="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="newgovtjobalert.com"
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                        disabled={isLoading}
                    />
                    <div>
                        <label htmlFor="filter-date" className="block text-sm font-medium text-gray-600 mb-1">Filter by Specific Deadline</label>
                        <input
                            id="filter-date"
                            type="date"
                            value={filterDate}
                            onChange={(e) => setFilterDate(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                            disabled={isLoading || showNextSixMonths}
                        />
                    </div>
                    <div className="sm:col-span-2 flex items-center mt-2">
                        <input
                            id="six-month-filter"
                            type="checkbox"
                            checked={showNextSixMonths}
                            onChange={(e) => toggleSixMonths(e.target.checked)}
                            className="w-4 h-4 text-indigo-600 bg-gray-100 border-gray-300 rounded focus:ring-indigo-500"
                            disabled={isLoading}
                        />
                        <label htmlFor="six-month-filter" className="ml-2 text-sm font-medium text-gray-700">Show only jobs with deadline in the next 6 months</label>
                    </div>
                </div>
                <div className="flex justify-end mb-6">
                    <button
                        onClick={handleFetchJobs}
                        disabled={isLoading}
                        className="w-full sm:w-auto bg-indigo-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed transition shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                    >
                        {isLoading ? 'Crawling...' : 'Start Scan'}
                    </button>
                </div>

                {isLoading && (
                    <div className="text-center p-4">
                        <div className="flex justify-center items-center mb-3">
                            <div className="animate-spin-slow rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
                        </div>
                        <p className="text-indigo-600 font-semibold">{status}</p>
                    </div>
                )}
                
                {filteredJobs.length > 0 && (
                    <div className="mt-8">
                        <h2 className="text-2xl font-bold text-gray-700 mb-4 border-b pb-2">Upcoming Deadlines Found</h2>
                        <ul className="space-y-4">
                            {jobsToShow.map((job) => (
                                <li key={job.link} className="p-4 bg-gray-50 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 transition-transform hover:scale-[1.01] border-l-4 border-green-500">
                                    <div className="flex-grow">
                                        <a href={job.link} target="_blank" rel="noopener noreferrer" className="text-lg font-semibold text-indigo-700 hover:underline">
                                            {job.title}
                                        </a>
                                        <p className="text-sm font-semibold text-red-600 mt-1">
                                            Last Date to Apply: {job.lastDate.toLocaleDateString('en-GB')}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                                        <a href={getWhatsAppLink(job)} target="_blank" rel="noopener noreferrer" className="bg-green-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-green-600 transition text-sm flex items-center justify-center" title="Share via WhatsApp">
                                            <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12.04 2.87c-5.06 0-9.17 4.1-9.17 9.17 0 1.54.4 3.01 1.15 4.34l-1.22 4.47a.97.97 0 001.32 1.32l4.47-1.22c1.33.74 2.8 1.15 4.34 1.15 5.07 0 9.17-4.11 9.17-9.17S17.11 2.87 12.04 2.87zm4.27 12.55l-.26.15a1.11 1.11 0 01-1.12.11 5.92 5.92 0 01-2.92-1.93 7.02 7.02 0 01-1.63-2.61.94.94 0 01.12-1.04l.15-.26c.21-.36.32-.8.32-1.25 0-.46-.11-.9-.32-1.26a.6.6 0 00-.31-.22c-.22-.09-.46-.14-.7-.14-.24 0-.48.05-.7.14a.6.6 0 00-.31.22c-.21.36-.32.8-.32 1.25 0 .46.11.9.32 1.25l.1.18c.24.42.36.9.36 1.4 0 .48-.12.92-.36 1.33-.24.42-.58.74-1.01.99-.42.25-.89.37-1.37.37-.48 0-.9-.12-1.28-.35-.38-.23-.67-.53-.88-.93-.21-.4-.32-.86-.32-1.34 0-.48.11-.93.32-1.34.21-.4.5-.7.88-.93.38-.23.79-.35 1.28-.35.48 0 .93-.12 1.34-.36.42-.24.74-.58.99-1.01.25-.42.37-.89.37-1.37 0-.48-.12-.93-.36-1.34-.24-.41-.58-.74-.99-.99-.42-.25-.89-.37-1.37-.37-.48 0-.93.12-1.34.36-.42.24-.74.58-.99 1.01-.25.42-.37.89-.37 1.37 0 .48-.11.93-.32 1.34-.21.4-.5.7-.88.93-.38.23-.79.35-1.28.35.48 0 .93.12 1.34.36-.42.24-.74.58-.99 1.01-.25.42-.37.89-.37 1.37 0 .48-.11.93-.32 1.34-.21.4-.5.7-.88.93-.38.23-.79.35-1.28.35.48 0 .93-.12-1.34-.36z" /></svg>
                                            WhatsApp
                                        </a>
                                        <button onClick={() => handleCopy(job)} className="bg-teal-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-teal-600 transition text-sm flex items-center justify-center" title="Copy formatted message">
                                            <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M16 1h-6c-1.1 0-2 .9-2 2v1H6c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-2V2c0-.55-.45-1-1-1zm-6 2h4v1h-4V3zm7 18H5c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1h1v14c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V5h-1c-.55 0-1 .45-1 1v14c0 1.1.9 2 2 2z"/></svg>
                                            {copiedJob === job.link ? 'Copied!' : 'Copy'}
                                        </button>
                                        <button onClick={() => handleNativeShare(job)} className="bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-600 transition text-sm flex items-center justify-center" title="Share with device">
                                            <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M18 16c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-5-1c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-4c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-4c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM4 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 4c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                                            Share
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                        <div className="flex justify-between items-center mt-6">
                            <button
                                disabled={page === 1}
                                onClick={goToPrevPage}
                                className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 transition"
                            >
                                Previous
                            </button>
                            <span className="text-gray-600">Page {page} of {totalPages}</span>
                            <button
                                disabled={page === totalPages}
                                onClick={goToNextPage}
                                className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 transition"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
