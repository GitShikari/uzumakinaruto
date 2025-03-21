const express = require('express');
const fetch = require('node-fetch');
const NodeCache = require('node-cache');
const { URL } = require('url');

const app = express();
const port = process.env.PORT || 3000;

// Cache for TS segments - 5 minutes TTL
const tsCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Function to extract stream URL from a series of requests
async function getStreamUrl(id) {
  try {
    console.log(`Processing stream for ID: ${id}`);
    
    // Step 1: Make the first request to get the fid and script src
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection': 'keep-alive',
      'Referer': 'https://cdn.crichdplays.ru/',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'iframe',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'Priority': 'u=4'
    };

    // First request to get fid and script src
    const firstResponse = await fetch(`https://cdn.crichdplays.ru/embed2.php?id=${id}`, {
      method: 'GET',
      headers: headers
    });

    if (!firstResponse.ok) {
      throw new Error(`First request failed with status: ${firstResponse.status}`);
    }

    const firstHtml = await firstResponse.text();
    
    // Extract fid, v_con, v_dt, and script src using regex
    const fidMatch = firstHtml.match(/fid="([^"]+)"/);
    const vConMatch = firstHtml.match(/v_con="([^"]+)"/);
    const vDtMatch = firstHtml.match(/v_dt="([^"]+)"/);
    // const scriptSrcMatch = firstHtml.match(/src="(https:\/\/player\d+\.vip\/zplayer\d+\.js\?[^"]+)"/);
    const scriptSrcMatch = "https://player002.vip/player2.js?v=7.061";
    if (!fidMatch || !scriptSrcMatch || !vConMatch || !vDtMatch) {
      throw new Error('Could not extract required parameters from first response');
    }
    
    const fid = fidMatch[1];
    const v_con = vConMatch[1];
    const v_dt = vDtMatch[1];
    const scriptSrc = "https://player002.vip/player2.js?v=7.061";
    
    console.log(`Extracted FID: ${fid}`);
    console.log(`Extracted v_con: ${v_con}`);
    console.log(`Extracted v_dt: ${v_dt}`);
    console.log(`Extracted Script Src: ${scriptSrc}`);
    
    // Step 2: Get the script content to extract the next URL
    const scriptResponse = await fetch(scriptSrc, {
      method: 'GET',
      headers: headers
    });
    
    if (!scriptResponse.ok) {
      throw new Error(`Script request failed with status: ${scriptResponse.status}`);
    }
    
    const scriptContent = await scriptResponse.text();
    
    // Extract the player URL base from the script content
    const playerUrlBaseMatch = scriptContent.match(/src="(https:\/\/zplayer\d+\.com\/[^"]+)"/);
    
    if (!playerUrlBaseMatch) {
      throw new Error('Could not extract player URL from script content');
    }
    
    // Construct the full player URL with the parameters
    const playerUrlBase = playerUrlBaseMatch[1];
    // Extract the base URL without the parameters
    const playerUrlClean = playerUrlBase.split('?')[0];
    // Construct the proper URL with all parameters
    const playerUrl = `${playerUrlClean}?v=${fid}&secure=${v_con}&expires=${v_dt}`;
    
    console.log(`Constructed Player URL: ${playerUrl}`);
    
    // Step 3: Get the final HTML that contains the m3u8 stream URL
    const finalResponse = await fetch(playerUrl, {
      method: 'GET',
      headers: headers
    });
    
    if (!finalResponse.ok) {
      throw new Error(`Final request failed with status: ${finalResponse.status}`);
    }
    
    const finalHtml = await finalResponse.text();
    
    // Extract the m3u8 stream URL
    const streamUrlMatch = finalHtml.match(/source: '([^']+\.m3u8[^']*)/);
    
    if (!streamUrlMatch) {
      throw new Error('Could not extract m3u8 stream URL from final response');
    }
    
    const streamUrl = streamUrlMatch[1];
    console.log(`Extracted Stream URL: ${streamUrl}`);
    
    return streamUrl;
  } catch (error) {
    console.error('Error getting stream URL:', error);
    throw error;
  }
}

// Route to handle the main m3u8 request
app.get('/:id.m3u8', async (req, res) => {
  try {
    const id = req.params.id;
    
    // Get the stream URL through our extraction process
    const streamUrl = await getStreamUrl(id);
    
    // Fetch the m3u8 content from the stream URL
    const response = await fetch(streamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
        'Referer': 'https://zplayer001.com/',
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch m3u8: ${response.status} ${response.statusText}`);
    }
    
    // Get the content type and set the response header
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
    // Rewrite the m3u8 content to use our proxy for internal URLs
    const data = await response.text();
    const rewrittenData = rewriteM3u8Content(data, streamUrl);
    
    // Send the rewritten response
    res.send(rewrittenData);
  } catch (error) {
    console.error('Error processing stream request:', error);
    res.status(500).json({ error: 'Failed to process stream request: ' + error.message });
  }
});

app.get('/proxy-stream/:url(*)', async (req, res) => {
  //   const streamUrl = decodeURIComponent(req.params.url);
  const streamUrl = `${req.params.url}?md6=${req.query.md6}&expires=${req.query.expires}`;
    
    if (!streamUrl) {
      return res.status(400).json({ error: 'Stream URL is required' });
    }
  
    try {
      // Check if we have the TS segment in cache
      if (streamUrl.endsWith('.ts')) {
        const cachedSegment = tsCache.get(streamUrl);
        
        if (cachedSegment) {
          console.log(`Serving cached TS segment for: ${streamUrl}`);
          
          // Set the content type from cached metadata
          if (cachedSegment.contentType) {
            res.setHeader('Content-Type', cachedSegment.contentType);
          }
          
          // Return the cached buffer
          return res.send(cachedSegment.data);
        }
      }
      
      // Not in cache or not a TS file, fetch from source
      console.log(`Fetching from source: ${streamUrl}`);
      const response = await fetch(streamUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
          'Referer': 'https://zplayer001.com/',
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
      }
      
      // Get content type and set response header
      const contentType = response.headers.get('content-type');
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      
      // For m3u8 files we rewrite the content but don't cache it
      if (streamUrl.endsWith('.m3u8')) {
        const data = await response.text();
        
        // Rewrite the content to use our proxy for internal URLs
        const rewrittenData = rewriteM3u8Content(data, streamUrl);
        
        // Send the rewritten response
        return res.send(rewrittenData);
      } 
      // For TS segment files, cache the binary data
      else if (streamUrl.endsWith('.ts')) {
        const buffer = await response.buffer();
        
        // Cache the buffer
        tsCache.set(streamUrl, {
          data: buffer,
          contentType: contentType
        });
        
        // Send the response
        return res.send(buffer);
      }
      // For other content, we stream directly without caching
      else {
        // Stream the response data to the client
        return response.body.pipe(res);
      }
    } catch (error) {
      console.error('Proxy stream error:', error);
      res.status(500).json({ error: 'Failed to proxy stream: ' + error.message });
    }
  });

  
// Helper function to rewrite m3u8 content to use our proxy
function rewriteM3u8Content(content, originalUrl) {
  // Extract the base parts of the URL for proper path resolution
  let origin = '';
  let basePath = '';
  
  try {
    const urlObj = new URL(originalUrl);
    origin = urlObj.origin;
    
    // Get the path up to the last slash (excluding the filename)
    const pathParts = urlObj.pathname.split('/');
    pathParts.pop(); // Remove the filename
    basePath = pathParts.join('/');
  } catch (e) {
    console.error('Error parsing original URL:', e);
  }
  
  // Rewrite segment URLs to go through our proxy
  return content.replace(/^((?!#).+\.ts|.+\.m3u8)$/gm, function(match) {
    // Handle absolute URLs, URLs starting with /, and relative URLs
    let absoluteUrl;
    
    if (match.startsWith('http')) {
      absoluteUrl = match;
    } else if (match.startsWith('/')) {
      absoluteUrl = origin + match;
    } else {
      // For relative URLs, properly join with the base path
      absoluteUrl = origin + basePath + '/' + match;
    }
    
    return `/proxy-stream/${absoluteUrl}`;
  });
}

// Start the server
app.listen(port, () => {
  console.log(`Stream proxy server running on port ${port}`);
});
