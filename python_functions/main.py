
import asyncio
import re
import logging
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
import chardet
from playwright.async_api import async_playwright

from firebase_admin import initialize_app
from firebase_functions import https_fn, options

# Initialize Firebase Admin SDK (if not already initialized)
if not initialize_app(cred=None, options=None, name='[DEFAULT]'): # Check if default app exists
    initialize_app()


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MIN_CONTENT_LENGTH = 300
STATIC_REQUEST_TIMEOUT = 15.0  # seconds
DYNAMIC_PAGE_LOAD_TIMEOUT = 45000  # milliseconds for Playwright
DYNAMIC_JS_WAIT_TIMEOUT = 2000 # milliseconds for additional JS rendering

# --- HTML Cleaning Utility ---
def clean_html_content(soup: BeautifulSoup) -> str:
    # Remove script, style, and other common non-content tags by selector
    selectors_to_remove = [
        'script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'video', 'audio', 'embed', 'object',
        'nav', 'footer', 'header', 'aside',
        'form', 'button', 'input', 'textarea', 'select', 'option', 'label',
        '.ad', '#ad', '[class*="advert"]', '[id*="advert"]',
        '.cookie', '#cookie', '[class*="cookie-consent"]', '[id*="cookie-banner"]',
        '.popup', '#popup', '.modal', '#modal',
        '.sidebar', '#sidebar', '.menu', '#menu', '.navigation', '#navigation',
        '[aria-hidden="true"]', '[hidden]',
        # Common selectors for comments sections
        '.comments', '#comments', '[class*="comment-"]', '[id*="comment-"]',
        # Common selectors for share buttons
        '[class*="social"]', '[id*="social"]', '[class*="share"]', '[id*="share"]'
    ]
    for selector in selectors_to_remove:
        for tag in soup.select(selector):
            if tag: # Ensure tag exists before decomposing
              tag.decompose()
    
    # Extract text content
    text = soup.get_text(separator='\n', strip=True)
    
    # Normalize whitespace
    text = re.sub(r'\n\s*\n', '\n\n', text) 
    text = re.sub(r'[ \t]{2,}', ' ', text)   
    text = re.sub(r'^\s+', '', text, flags=re.MULTILINE) 
    
    return text.strip()

# --- Subpage Discovery Utility ---
def find_relevant_subpages(base_url: str, soup: BeautifulSoup) -> list[str]:
    potential_links = []
    # Keywords for subpages, matching typical "About Us" type pages
    keywords = ["/about", "/company", "/who-we-are", "/story", "/mission", "/vision", "/profile", "/organization"]
    link_text_keywords = [kw.replace("/", "").replace("-", " ") for kw in keywords] # for link text matching

    parsed_base_url = urlparse(base_url)
    
    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"]
        # Normalize URL: make absolute, remove fragments
        full_url = urljoin(base_url, href.split('#')[0].strip())
        
        parsed_link_url = urlparse(full_url)

        # Check if it's an internal link (same domain or relative) and not an obvious non-HTML link
        if (parsed_link_url.netloc == parsed_base_url.netloc or not parsed_link_url.netloc) and \
           not any(full_url.lower().endswith(ext) for ext in ['.pdf', '.jpg', '.png', '.zip', '.mp4']):
            path = parsed_link_url.path.lower()
            link_text = a_tag.get_text().lower().strip()

            if any(keyword in path for keyword in keywords) or \
               any(lt_keyword in link_text for lt_keyword in link_text_keywords):
                if full_url not in potential_links and full_url != base_url:
                    potential_links.append(full_url)
    
    potential_links = list(set(potential_links)) # Deduplicate
    potential_links.sort(key=len) # Prefer shorter (often more primary) paths
    logger.info(f"Found {len(potential_links)} potential subpages: {potential_links[:5]}")
    return potential_links[:2] # Return top 1-2 matched internal links

# --- Static Scraping ---
async def static_scrape_page_raw(url: str) -> tuple[bytes | None, str | None]:
    logger.info(f"Attempting static scrape for URL: {url}")
    # Common user agent to avoid basic blocks
    headers = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36 OverviewerScraper/1.0'}
    try:
        async with httpx.AsyncClient(timeout=STATIC_REQUEST_TIMEOUT, follow_redirects=True, verify=False) as client: # Added verify=False for SSL issues
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            
            content_type = response.headers.get('content-type', '').lower()
            if 'text/html' not in content_type:
                logger.warning(f"Static scrape: Non-HTML content type '{content_type}' for {url}")
                return None, None

            content_bytes = await response.aread() # Use aread() for async read
            encoding = chardet.detect(content_bytes)['encoding'] or 'utf-8'
            logger.info(f"Static scrape successful for {url}, detected encoding: {encoding}")
            return content_bytes, encoding
    except httpx.HTTPStatusError as e:
        logger.error(f"Static scrape HTTPStatusError for {url}: {e.response.status_code} - {e}")
    except httpx.RequestError as e: # Handles ConnectError, TimeoutException, etc.
        logger.error(f"Static scrape RequestError for {url}: {e}")
    except Exception as e:
        logger.error(f"Static scrape generic error for {url}: {e}")
    return None, None

# --- Dynamic Scraping (Playwright) ---
async def get_dynamic_content_html(url: str, playwright_instance) -> str | None:
    logger.info(f"Attempting dynamic scrape for URL: {url}")
    html_content = None
    browser = None
    try:
        # For Firebase, specific launch args might be needed if not using a high-memory instance
        # that pre-installs browsers. Default Python 3.10+ 1GB+ instances should be fine.
        browser = await playwright_instance.chromium.launch() # args=['--no-sandbox'] potentially
        page = await browser.new_page()
        await page.set_extra_http_headers({"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36 OverviewerScraper/1.0"})
        
        # Optimization: Abort requests for non-essential resources
        await page.route("**/*", lambda route: route.abort() if route.request.resource_type in ["image", "stylesheet", "font", "media", "websocket"] else route.continue_())

        await page.goto(url, wait_until="domcontentloaded", timeout=DYNAMIC_PAGE_LOAD_TIMEOUT)
        await page.wait_for_timeout(DYNAMIC_JS_WAIT_TIMEOUT) # Allow time for JS execution

        html_content = await page.content()
        if html_content:
            logger.info(f"Successfully fetched dynamic HTML for {url} (length: {len(html_content)})")
        else:
            logger.warning(f"Dynamic scrape for {url} yielded no HTML content.")
        return html_content
    except Exception as e:
        logger.error(f"Playwright error for {url}: {e}")
        return None
    finally:
        if browser:
            await browser.close()

# --- Main Cloud Function ---
@https_fn.on_call(
    region="us-central1", # Choose your preferred region
    memory=options.MemoryOption.GB_1, # 1GB recommended for Playwright
    timeout_sec=300 # 5 minutes, scraping can be slow
)
async def scrape_website_content(req: https_fn.CallableRequest) -> dict:
    url = req.data.get("url")
    if not url or not isinstance(url, str):
        logger.error("Invalid URL provided in request.")
        raise https_fn.HttpsError(code="invalid-argument", message="A valid 'url' string is required.")

    logger.info(f"Received scrape request for URL: {url}")

    # Basic URL normalization
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    try:
        parsed_url_check = urlparse(url)
        if not parsed_url_check.scheme or not parsed_url_check.netloc:
             raise ValueError("Invalid URL structure")
    except ValueError:
        logger.error(f"URL '{url}' is not valid after normalization.")
        raise https_fn.HttpsError(code="invalid-argument", message=f"Provided URL '{url}' is not valid.")


    # Variables to track results
    processed_sources = set() # To avoid re-processing (url, method) tuples
    best_short_text = ""
    best_short_text_info = {}
    
    # Initialize Playwright once for the entire function call if dynamic scraping is needed
    async with async_playwright() as p_instance:

        async def attempt_scrape_logic(page_url_to_scrape: str, method: str):
            nonlocal best_short_text, best_short_text_info # Allow modification of outer scope vars

            if (page_url_to_scrape, method) in processed_sources:
                logger.info(f"Skipping already processed: {page_url_to_scrape} with {method}")
                return None # Already processed
            processed_sources.add((page_url_to_scrape, method))

            logger.info(f"Attempting {method} scrape for: {page_url_to_scrape}")
            raw_html_content = None
            detected_encoding = 'utf-8' # Default

            if method == "static":
                content_bytes, encoding_from_static = await static_scrape_page_raw(page_url_to_scrape)
                if content_bytes:
                    raw_html_content = content_bytes
                    if encoding_from_static: # Use detected encoding if available
                         detected_encoding = encoding_from_static
            elif method == "dynamic":
                raw_html_content = await get_dynamic_content_html(page_url_to_scrape, p_instance)
                # Playwright generally provides UTF-8 decoded strings or handles encoding internally

            if not raw_html_content:
                logger.warning(f"{method} scrape failed to get HTML for {page_url_to_scrape}")
                return {'status': 'failed_fetch', 'url': page_url_to_scrape, 'method': method}

            try:
                # If content is bytes (from static), decode it. If string (from dynamic), use directly.
                if isinstance(raw_html_content, bytes):
                    soup = BeautifulSoup(raw_html_content, 'html.parser', from_encoding=detected_encoding)
                else: # string from Playwright
                    soup = BeautifulSoup(raw_html_content, 'html.parser')
            except Exception as e:
                logger.error(f"BeautifulSoup parsing error for {page_url_to_scrape} ({method}): {e}")
                return {'status': 'failed_parse', 'url': page_url_to_scrape, 'method': method, 'soup': None}
            
            cleaned_text = clean_html_content(soup)
            
            if len(cleaned_text) >= MIN_CONTENT_LENGTH:
                logger.info(f"Sufficient content found from {page_url_to_scrape} ({method}). Length: {len(cleaned_text)}")
                return {
                    'status': 'success', 
                    'content': cleaned_text, 
                    'source_url': page_url_to_scrape, 
                    'method': method
                }
            else:
                logger.info(f"Content from {page_url_to_scrape} ({method}) too short: {len(cleaned_text)} chars.")
                if len(cleaned_text) > len(best_short_text):
                    best_short_text = cleaned_text
                    best_short_text_info = {'source_url': page_url_to_scrape, 'method': method, 'length': len(cleaned_text)}
                
                return {'status': 'short', 'text': cleaned_text, 'soup': soup, 'url': page_url_to_scrape, 'method': method}

        # --- Scraping Strategy ---
        # 1. Static scrape on main URL
        main_static_result = await attempt_scrape_logic(url, "static")
        if main_static_result and main_static_result['status'] == 'success':
            return main_static_result

        subpages = []
        if main_static_result and main_static_result.get('soup'):
            subpages = find_relevant_subpages(url, main_static_result['soup'])

        # 2. Static scrape on subpages (if any found)
        if subpages:
            for sub_url in subpages:
                sub_static_result = await attempt_scrape_logic(sub_url, "static")
                if sub_static_result and sub_static_result['status'] == 'success':
                    return sub_static_result
        
        # 3. Dynamic scrape on main URL
        main_dynamic_result = await attempt_scrape_logic(url, "dynamic")
        if main_dynamic_result and main_dynamic_result['status'] == 'success':
            return main_dynamic_result

        # If subpages not found yet and dynamic main scrape got soup
        if not subpages and main_dynamic_result and main_dynamic_result.get('soup'):
            subpages = find_relevant_subpages(url, main_dynamic_result['soup'])
            if subpages: logger.info(f"Found subpages after dynamic main scrape: {subpages}")

        # 4. Dynamic scrape on subpages (if any found)
        if subpages:
            for sub_url in subpages:
                sub_dynamic_result = await attempt_scrape_logic(sub_url, "dynamic")
                if sub_dynamic_result and sub_dynamic_result['status'] == 'success':
                    return sub_dynamic_result

    # --- Final Result Handling ---
    if best_short_text_info:
        logger.warning(f"All attempts yielded short content. Best short text from: {best_short_text_info}")
        return {
            "status": "error", 
            "reason": "content_too_short", 
            "message": f"Scraped content was less than {MIN_CONTENT_LENGTH} characters. Best found had {best_short_text_info['length']} chars from {best_short_text_info['source_url']} via {best_short_text_info['method']}.",
            # "content": best_short_text, # Optionally return the short content
            "source_url": best_short_text_info['source_url'],
            "method": best_short_text_info['method']
        }
    else:
        logger.error(f"No usable content found for URL: {url} after all attempts.")
        return {
            "status": "error", 
            "reason": "not_found", 
            "message": "Could not find or access relevant content on the website after trying primary and potential subpages with static and dynamic methods."
        }

# Example of how to test locally (requires async environment)
# async def main_local_test():
#     # Mock CallableRequest
#     class MockCallableRequest:
#         def __init__(self, data):
#             self.data = data
#     
#     test_url = "https://www.google.com" # Replace with a test URL
#     req = MockCallableRequest(data={"url": test_url})
#     result = await scrape_website_content(req)
#     print("---SCRAPE RESULT---")
#     if result.get('content'):
#         print(f"Status: {result.get('status')}, Method: {result.get('method')}, URL: {result.get('source_url')}")
#         print(f"Content (first 500 chars): {result.get('content', '')[:500]}...")
#     else:
#         print(result)
#
# if __name__ == '__main__':
#    asyncio.run(main_local_test())
