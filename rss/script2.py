import sys
import json
from pymongo import MongoClient
import os
from sentence_transformers import SentenceTransformer
import numpy as np
import faiss
import re
import requests
import torch
from functools import lru_cache
import logging
import signal
import time

# Setup logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Create Flask app
from flask import Flask, request, jsonify
app = Flask(__name__)

def extract_first_paragraph(text):
    """
    Extract the first paragraph from HTML content or return the plain text.
    This handles different types of HTML structures.
    """
    if not text or not isinstance(text, str):
        return ""

    # Check if it's HTML content
    if "<" in text and ">" in text:
        # Try to find first paragraph tag
        p_match = re.search(r'<p>(.*?)</p>', text, re.DOTALL)
        if p_match:
            return p_match.group(1)

        # If no paragraph tag, try other common containers
        div_match = re.search(r'<div>(.*?)</div>', text, re.DOTALL)
        if div_match:
            return div_match.group(1)

        # Try to extract anything between the first set of tags
        tag_content = re.search(r'<[^>]+>(.*?)</[^>]+>', text, re.DOTALL)
        if tag_content:
            return tag_content.group(1)

    # For plain text, return the first paragraph (split by double newline)
    paragraphs = text.split('\n\n')
    if paragraphs:
        return paragraphs[0]

    return text


@lru_cache(maxsize=128)
def is_valid_pincode(pincode):
    """Check if a given pincode is valid (6-digit number)."""
    return re.match(r"^\d{6}$", str(pincode)) is not None


@lru_cache(maxsize=128)
def get_location_details(pincode):
    """Fetch and return location details for the given pincode using Nominatim API."""
    if not is_valid_pincode(pincode):
        return {"error": "Invalid Pincode! Must be a 6-digit number."}

    url = f"https://nominatim.openstreetmap.org/search?postalcode={pincode}&countrycodes=IN&format=json&addressdetails=1"
    headers = {"User-Agent": "news-search-service"}  # Required to avoid blocking by Nominatim

    try:
        response = requests.get(url, headers=headers, timeout=5)
        data = response.json()

        if not data:
            return {"error": "No location found for this pincode."}

        address = data[0].get("address", {})
        return {
            "Village": address.get("village") or '',
            "Town": address.get("town") or '',
            "City": address.get("city") or '',
            "City District": address.get("city_district") or '',
            "State District": address.get("state_district") or '',
            "State": address.get("state") or '',
            "Country": address.get("country") or '',
        }
    except (requests.RequestException, ValueError) as e:
        return {"error": f"API error: {str(e)}"}

# Environment variables for secure configuration
MONGODB_URI = os.environ.get("MONGODB_URI")
DATABASE_NAME = os.environ.get("DATABASE_NAME", "newsDB")
COLLECTION_NAME = os.environ.get("COLLECTION_NAME", "news_articles")
INDEX_FILE_PATH = os.environ.get("INDEX_FILE_PATH", "news_search.index")
ARTICLE_IDS_FILE_PATH = os.environ.get("ARTICLE_IDS_FILE_PATH", "article_ids.json")
CACHE_EXPIRY = int(os.environ.get("CACHE_EXPIRY", "86400"))  # 24 hours in seconds
MODEL_NAME = os.environ.get("MODEL_NAME", "sentence-transformers/all-MiniLM-L6-v2")

if not MONGODB_URI:
    logger.error("MONGODB_URI not set")
    sys.exit(1)

# Global variables for persistence
global_mongo_client = None
global_db = None
global_collection = None
global_model = None
global_faiss_index = None
global_article_ids = None
last_index_update = 0

def initialize_mongodb():
    """Initialize MongoDB connection with connection pooling."""
    global global_mongo_client, global_db, global_collection

    if global_mongo_client is None:
        logger.info("Initializing MongoDB connection...")
        print("Initializing MongoDB connection...", file=sys.stderr) #Added print statement
        global_mongo_client = MongoClient(MONGODB_URI, maxPoolSize=10)
        global_db = global_mongo_client[DATABASE_NAME]
        global_collection = global_db[COLLECTION_NAME]
        logger.info("MongoDB connection established")
        print("MongoDB connection established", file=sys.stderr) #Added print statement

def initialize_model():
    """Initialize the sentence transformer model."""
    global global_model

    if global_model is None:
        logger.info("Loading sentence transformer model...")
        print("Loading sentence transformer model...", file=sys.stderr) #Added print statement
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        logger.info(f"Using device: {device}")
        print(f"Using device: {device}", file=sys.stderr) #Added print statement

        try:
            global_model = SentenceTransformer(MODEL_NAME)
            global_model.to(device)
            logger.info(f"Model loaded successfully on {device}")
            print(f"Model loaded successfully on {device}", file=sys.stderr) #Added print statement
        except Exception as e:
            logger.error(f"Error loading model: {str(e)}")
            print(f"Error loading model: {str(e)}", file=sys.stderr) #Added print statement
            sys.exit(1)

def build_faiss_index(vectors, dimension):
    """Builds a FAISS index appropriately sized for the dataset."""
    try:
        start_time = time.time()
        vectors_np = np.array(vectors).astype("float32")
        num_vectors = len(vectors)

        if num_vectors < 1000:
            logger.info(f"Using flat index for small dataset ({num_vectors} vectors)")
            print(f"Using flat index for small dataset ({num_vectors} vectors)", file=sys.stderr) #Added print statement
            index = faiss.IndexFlatL2(dimension)
            index.add(vectors_np)
        else:
            nlist = min(int(4 * np.sqrt(num_vectors)), num_vectors // 39)
            nlist = max(nlist, 1)  # Ensure at least 1 centroid

            logger.info(f"Using IVF index with {nlist} clusters for {num_vectors} vectors")
            print(f"Using IVF index with {nlist} clusters for {num_vectors} vectors", file=sys.stderr) #Added print statement
            quantizer = faiss.IndexFlatL2(dimension)
            index = faiss.IndexIVFFlat(quantizer, dimension, nlist, faiss.METRIC_L2)
            index.train(vectors_np)
            index.add(vectors_np)

        logger.info(f"Index built in {time.time() - start_time:.2f} seconds")
        print(f"Index built in {time.time() - start_time:.2f} seconds", file=sys.stderr) #Added print statement
        return index
    except Exception as e:
        logger.error(f"Error building index: {str(e)}")
        print(f"Error building index: {str(e)}", file=sys.stderr) #Added print statement
        return None

def save_index_and_ids(index, article_ids):
    """Save FAISS index and article IDs to disk."""
    try:
        # Save FAISS index
        logger.info(f"Saving FAISS index to {INDEX_FILE_PATH}")
        print(f"Saving FAISS index to {INDEX_FILE_PATH}", file=sys.stderr) #Added print statement
        faiss.write_index(index, INDEX_FILE_PATH)

        # Save article IDs
        logger.info(f"Saving article IDs to {ARTICLE_IDS_FILE_PATH}")
        print(f"Saving article IDs to {ARTICLE_IDS_FILE_PATH}", file=sys.stderr) #Added print statement
        with open(ARTICLE_IDS_FILE_PATH, 'w') as f:
            json.dump([str(id) for id in article_ids], f)

        logger.info("Index and article IDs saved successfully")
        print("Index and article IDs saved successfully", file=sys.stderr) #Added print statement
        return True
    except Exception as e:
        logger.error(f"Error saving index and IDs: {str(e)}")
        print(f"Error saving index and IDs: {str(e)}", file=sys.stderr) #Added print statement
        return False

def load_index_and_ids():
    """Load FAISS index and article IDs from disk if available."""
    try:
        # Check if files exist
        if not os.path.exists(INDEX_FILE_PATH) or not os.path.exists(ARTICLE_IDS_FILE_PATH):
            logger.info("Index files not found, will build new index")
            print("Index files not found, will build new index", file=sys.stderr) #Added print statement
            return None, None

        # Load FAISS index
        logger.info(f"Loading FAISS index from {INDEX_FILE_PATH}")
        print(f"Loading FAISS index from {INDEX_FILE_PATH}", file=sys.stderr) #Added print statement
        index = faiss.read_index(INDEX_FILE_PATH)

        # Load article IDs
        logger.info(f"Loading article IDs from {ARTICLE_IDS_FILE_PATH}")
        print(f"Loading article IDs from {ARTICLE_IDS_FILE_PATH}", file=sys.stderr) #Added print statement
        with open(ARTICLE_IDS_FILE_PATH, 'r') as f:
            article_ids = json.load(f)
            # Convert string IDs back to ObjectIDs if needed
            from bson import ObjectId
            article_ids = [ObjectId(id) if not isinstance(id, ObjectId) else id for id in article_ids]

        logger.info(f"Loaded index with {len(article_ids)} articles")
        print(f"Loaded index with {len(article_ids)} articles", file=sys.stderr) #Added print statement
        return index, article_ids
    except Exception as e:
        logger.error(f"Error loading index and IDs: {str(e)}")
        print(f"Error loading index and IDs: {str(e)}", file=sys.stderr) #Added print statement
        return None, None

def encode_articles_batch(articles_batch):
    """Encodes a batch of articles using the model."""
    global global_model

    encoded_articles = []
    for article in articles_batch:
        try:
            title = article.get("title", "No Title")
            raw_description = article.get("description", "No Description")

            # Apply the improved extraction function
            description = extract_first_paragraph(raw_description)

            # Store both raw and processed description
            article['processed_description'] = description

            text_to_encode = f"{title}. {description}"

            if global_model:
                try:
                    device = next(global_model.parameters()).device.type if hasattr(global_model, 'parameters') else 'cpu'
                    vector = global_model.encode(text_to_encode, device=device).tolist()
                    article['vector'] = vector
                    encoded_articles.append(article)
                except Exception as e:
                    logger.error(f"Encoding error: {str(e)}")
                    print(f"Encoding error: {str(e)}", file=sys.stderr) #Added print statement
            else:
                logger.error("Model not initialized")
                print("Model not initialized", file=sys.stderr) #Added print statement
        except Exception as e:
            logger.error(f"Article processing error: {str(e)}")
            print(f"Article processing error: {str(e)}", file=sys.stderr) #Added print statement

    return encoded_articles

def load_data_and_build_index(force_rebuild=False):
    """Load data from MongoDB, encode vectors, and build or update the FAISS index."""
    global global_collection, global_model, last_index_update

    try:
        print("load_data_and_build_index: Starting", file=sys.stderr)  # Added print statement
        # Check if we can load from disk
        if not force_rebuild:
            print("load_data_and_build_index: Attempting to load index from disk", file=sys.stderr)  # Added print statement
            index, article_ids = load_index_and_ids()
            if index is not None and article_ids is not None:
                last_index_update = time.time()
                print("load_data_and_build_index: Loaded index from disk", file=sys.stderr)  # Added print statement
                return index, article_ids
            else:
                print("load_data_and_build_index: Failed to load index from disk, proceeding to build new index", file=sys.stderr)  # Added print statement

        # Initialize MongoDB if not already done
        if global_collection is None:
            print("load_data_and_build_index: Initializing MongoDB", file=sys.stderr)  # Added print statement
            initialize_mongodb()

        # Initialize model if not already done
        if global_model is None:
            print("load_data_and_build_index: Initializing Model", file=sys.stderr)  # Added print statement
            initialize_model()

        logger.info("Fetching articles from database...")
        print("load_data_and_build_index: Fetching articles from database...", file=sys.stderr)  # Added print statement
        articles = list(global_collection.find({}, {"_id": 1, "title": 1, "description": 1, "vector": 1}))

        if not articles:
            logger.warning("No articles found in database.")
            print("load_data_and_build_index: No articles found in database.", file=sys.stderr)  # Added print statement
            return None, None

        # Performance optimization: Check if vectors already exist
        articles_with_vectors = [article for article in articles if article.get('vector')]
        articles_without_vectors = [article for article in articles if not article.get('vector')]

        encoded_articles = articles_with_vectors

        # Only encode articles that don't have vectors
        if articles_without_vectors:
            logger.info(f"Encoding {len(articles_without_vectors)} articles without vectors...")
            print(f"load_data_and_build_index: Encoding {len(articles_without_vectors)} articles without vectors...", file=sys.stderr)  # Added print statement

            # Split articles into batches
            batch_size = 100
            batches = [articles_without_vectors[i:i+batch_size] for i in range(0, len(articles_without_vectors), batch_size)]

            # Process batches
            for i, batch in enumerate(batches):
                logger.info(f"Processing batch {i+1}/{len(batches)}")
                print(f"load_data_and_build_index: Processing batch {i+1}/{len(batches)}", file=sys.stderr)  # Added print statement
                batch_encoded = encode_articles_batch(batch)
                encoded_articles.extend(batch_encoded)

                # Update database with new vectors (using bulk operation)
                if batch_encoded:
                    logger.info(f"Updating database with {len(batch_encoded)} new vectors...")
                    print(f"load_data_and_build_index: Updating database with {len(batch_encoded)} new vectors...", file=sys.stderr)  # Added print statement
                    bulk_operations = []
                    for article in batch_encoded:
                        if '_id' in article and 'vector' in article:
                            bulk_operations.append(
                                {
                                    "update_one": {
                                        "filter": {"_id": article["_id"]},
                                        "update": {"$set": {"vector": article["vector"]}}
                                    }
                                }
                            )

                    if bulk_operations:
                        result = global_collection.bulk_write([op for item in bulk_operations for op in [item["update_one"]]])
                        logger.info(f"Bulk update complete: {result.modified_count} documents modified")
                        print(f"load_data_and_build_index: Bulk update complete: {result.modified_count} documents modified", file=sys.stderr)  # Added print statement

        # Filter out articles without vectors
        filtered_encoded_articles = [article for article in encoded_articles if article.get('vector')]

        if not filtered_encoded_articles:
            logger.warning("No articles with valid vectors found.")
            print("load_data_and_build_index: No articles with valid vectors found.", file=sys.stderr)  # Added print statement
            return None, None

        article_ids = [article["_id"] for article in filtered_encoded_articles]
        vectors = [article["vector"] for article in filtered_encoded_articles]

        dimension = len(vectors[0])
        logger.info(f"Building index with {len(vectors)} vectors of dimension {dimension}...")
        print(f"load_data_and_build_index: Building index with {len(vectors)} vectors of dimension {dimension}...", file=sys.stderr)  # Added print statement

        faiss_index = build_faiss_index(vectors, dimension)

        # Save index to disk for future use
        save_index_and_ids(faiss_index, article_ids)

        last_index_update = time.time()
        print("load_data_and_build_index: Index built and saved successfully", file=sys.stderr)  # Added print statement
        return faiss_index, article_ids

    except Exception as e:
        logger.error(f"Error loading data: {str(e)}")
        print(f"load_data_and_build_index: Error loading data: {str(e)}", file=sys.stderr)  # Added print statement
        return None, None
    finally:
        print("load_data_and_build_index: Ending", file=sys.stderr)  # Added print statement

def search_articles_with_faiss(search_query, faiss_index, article_ids, top_k=30):
    """Performs a similarity search using the Faiss index."""
    global global_model, global_collection

    try:
        print(f"search_articles_with_faiss: Starting with query: {search_query}", file=sys.stderr)  # Added print statement
        if global_model is None:
            logger.error("Model not initialized")
            print("search_articles_with_faiss: Model not initialized", file=sys.stderr)  # Added print statement
            return []

        # Get device from model
        device = next(global_model.parameters()).device.type if hasattr(global_model, 'parameters') else 'cpu'

        # Encode search query
        search_vector = global_model.encode(search_query, device=device)
        search_vector = search_vector.reshape(1, -1).astype("float32")

        # Set nprobe based on index type and size
        if isinstance(faiss_index, faiss.IndexIVFFlat):
            # For IVF indices, nprobe should be a fraction of nlist
            nlist = faiss_index.nlist
            nprobe = max(1, min(nlist // 4, 10))  # Set nprobe to 1/4 of nlist, max 10
            logger.debug(f"Using nprobe={nprobe} for search")
            print(f"search_articles_with_faiss: Using nprobe={nprobe} for search", file=sys.stderr)  # Added print statement
            faiss_index.nprobe = nprobe

        D, I = faiss_index.search(search_vector, top_k)

        results = []
        batch_indices = [int(i) for i in I[0] if i >= 0 and i < len(article_ids)]

        if not batch_indices:
            print("search_articles_with_faiss: No results found in FAISS index", file=sys.stderr)  # Added print statement
            return []

        # Performance optimization: Batch database queries
        batch_ids = [article_ids[i] for i in batch_indices]

        # Make sure MongoDB is initialized
        if global_collection is None:
            print("search_articles_with_faiss: Initializing MongoDB", file=sys.stderr)  # Added print statement
            initialize_mongodb()

        articles = list(global_collection.find(
            {"_id": {"$in": batch_ids}},
            {"_id": 1, "title": 1, "link": 1, "description": 1, "processed_description": 1}
        ))

        # Create a mapping for faster lookup
        articles_map = {str(article.get("_id")): article for article in articles}

        results = []
        for idx in batch_indices:
            article_id = article_ids[idx]
            if str(article_id) in articles_map:
                article = articles_map[str(article_id)]

                # Process description if not already processed
                if 'processed_description' not in article or not article['processed_description']:
                    article['processed_description'] = extract_first_paragraph(article.get('description', ''))

                results.append(article)

        print(f"search_articles_with_faiss: Found {len(results)} results", file=sys.stderr)  # Added print statement
        return results

    except Exception as e:
        logger.error(f"Search error: {str(e)}")
        print(f"search_articles_with_faiss: Search error: {str(e)}", file=sys.stderr)  # Added print statement
        return []
    finally:
        print("search_articles_with_faiss: Ending", file=sys.stderr)  # Added print statement


def detect_and_process_pincode(search_term):
    """Detects if a 6-digit pincode is present and gets location terms."""
    print(f"detect_and_process_pincode: Starting with term: {search_term}", file=sys.stderr) #Added print statement
    pincode_matches = re.findall(r'\b(\d{6})\b', search_term)
    if pincode_matches:
        pincode = pincode_matches[0]
        location_details = get_location_details(pincode)
        if 'error' not in location_details:
            location_terms = [value for value in location_details.values() if value]
            print(f"detect_and_process_pincode: Found location terms: {location_terms}", file=sys.stderr) #Added print statement
            return location_terms
    print("detect_and_process_pincode: No pincode or valid location found", file=sys.stderr) #Added print statement
    return []

def rank_results(results, location_terms):
    """Ranks search results based on the presence of location terms in the title and description."""
    print(f"rank_results: Starting with {len(results)} results, location terms: {location_terms}", file=sys.stderr) #Added print statement
    if not location_terms:
        print("rank_results: No location terms, returning original results", file=sys.stderr) #Added print statement
        return results

    # Performance optimization: Use sets for faster lookups
    ranked_results = []
    seen_articles = set()

    for term in location_terms:
        term_lower = term.lower()
        for article in results:
            # Use a unique identifier for the article
            article_id = article.get('link', '')

            if article_id in seen_articles:
                continue

            if term_lower in article.get('title', '').lower() or term_lower in article.get('description', '').lower():
                ranked_results.append(article)
                seen_articles.add(article_id)

    # Add remaining articles
    for article in results:
        article_id = article.get('link', '')
        if article_id not in seen_articles:
            ranked_results.append(article)
            seen_articles.add(article_id)
    print(f"rank_results: Returning {len(ranked_results)} ranked results", file=sys.stderr) #Added print statement
    return ranked_results

def check_and_update_index():
    """Check if index needs to be updated based on time or database changes."""
    global global_faiss_index, global_article_ids, last_index_update, CACHE_EXPIRY
    print("check_and_update_index: Starting", file=sys.stderr)  # Added print statement
    current_time = time.time()

    # Check if index is expired
    if current_time - last_index_update > CACHE_EXPIRY:
        logger.info("Index cache expired, rebuilding...")
        print("check_and_update_index: Index cache expired, rebuilding...", file=sys.stderr)  # Added print statement
        global_faiss_index, global_article_ids = load_data_and_build_index(force_rebuild=True)
    else:
        print("check_and_update_index: Index cache is still valid", file=sys.stderr)  # Added print statement
    print("check_and_update_index: Ending", file=sys.stderr)  # Added print statement

# API endpoints
@app.route('/search', methods=['POST'])
def search():
    print("search: Starting", file=sys.stderr)  # Added print statement
    start_time = time.time()

    # Get search query from request
    data = request.json
    search_term = data.get('query')

    if not search_term:
        print("search: No search query provided", file=sys.stderr)  # Added print statement
        return jsonify({"error": "No search query provided"}), 400

    # Initialize resources if needed
    global global_faiss_index, global_article_ids

    if global_faiss_index is None or global_article_ids is None:
        print("search: First-time initialization of index and resources", file=sys.stderr)  # Added print statement
        global_faiss_index, global_article_ids = load_data_and_build_index()

        if global_faiss_index is None or global_article_ids is None:
            print("search: Failed to initialize search index", file=sys.stderr)  # Added print statement
            return jsonify({"error": "Failed to initialize search index"}), 500

    # Check if index needs updating
    check_and_update_index()

    # Get location terms
    location_terms = detect_and_process_pincode(search_term)

    # Perform search
    logger.info(f"Searching for: {search_term}")
    print(f"search: Searching for: {search_term}", file=sys.stderr)  # Added print statement
    results = search_articles_with_faiss(
        search_term,
        global_faiss_index,
        global_article_ids
    )

    # Format the results
    formatted_results = []
    if results:
        ranked_results = rank_results(results, location_terms)
        for article in ranked_results:
            # Use processed_description if available, otherwise extract it now
            description = article.get('processed_description', None)
            if not description:
                description = extract_first_paragraph(article.get('description', 'N/A'))

            formatted_results.append({
                "title": article.get('title', 'N/A'),
                "description": description,  # Use the processed description
                "full_description": article.get('description', 'N/A'),  # Include full description if needed
                "link": article.get('link', 'N/A')
            })

    search_time = time.time() - start_time
    logger.info(f"Search completed in {search_time:.2f} seconds, found {len(formatted_results)} results")
    print(f"search: Search completed in {search_time:.2f} seconds, found {len(formatted_results)} results", file=sys.stderr)  # Added print statement

    print("search: Ending", file=sys.stderr)  # Added print statement
    return jsonify(formatted_results)

@app.route('/healthcheck', methods=['GET'])
def healthcheck():
    """Simple endpoint to check if the service is running."""
    print("healthcheck: Called", file=sys.stderr)  # Added print statement
    return jsonify({"status": "ok", "service": "news-search-service"})

@app.route('/rebuild-index', methods=['POST'])
def rebuild_index():
    """Force rebuild of the index."""
    print("rebuild_index: Called", file=sys.stderr)  # Added print statement
    global global_faiss_index, global_article_ids

    try:
        logger.info("Forced index rebuild requested")
        print("rebuild_index: Forced index rebuild requested", file=sys.stderr)  # Added print statement
        global_faiss_index, global_article_ids = load_data_and_build_index(force_rebuild=True)

        if global_faiss_index is None or global_article_ids is None:
            print("rebuild_index: Failed to rebuild index", file=sys.stderr)  # Added print statement
            return jsonify({"error": "Failed to rebuild index"}), 500

        print(f"rebuild_index: Index rebuilt with {len(global_article_ids)} articles", file=sys.stderr)  # Added print statement
        return jsonify({"status": "success", "message": f"Index rebuilt with {len(global_article_ids)} articles"})
    except Exception as e:
        logger.error(f"Error rebuilding index: {str(e)}")
        print(f"rebuild_index: Error rebuilding index: {str(e)}", file=sys.stderr)  # Added print statement
        return jsonify({"error": f"Failed to rebuild index: {str(e)}"}), 500

# Initialize resources at startup
def initialize_resources():
    """Initialize all resources at startup."""
    print("initialize_resources: Starting", file=sys.stderr)  # Added print statement
    global global_faiss_index, global_article_ids

    # Initialize MongoDB connection
    initialize_mongodb()

    # Initialize model
    initialize_model()

    # Load or build index
    logger.info("Loading data and building index at startup...")
    print("initialize_resources: Loading data and building index at startup...", file=sys.stderr)  # Added print statement
    global_faiss_index, global_article_ids = load_data_and_build_index()

    if global_faiss_index is None or global_article_ids is None:
        logger.error("Failed to initialize index at startup")
        print("initialize_resources: Failed to initialize index at startup", file=sys.stderr)  # Added print statement
        sys.exit(1)

    logger.info(f"Index initialized successfully with {len(global_article_ids)} articles")
    print(f"initialize_resources: Index initialized successfully with {len(global_article_ids)} articles", file=sys.stderr)  # Added print statement
    print("initialize_resources: Ending", file=sys.stderr)  # Added print statement

# Graceful shutdown handler
def graceful_shutdown(signum, frame):
    """Handle graceful shutdown, closing resources."""
    print("graceful_shutdown: Starting", file=sys.stderr)  # Added print statement
    global global_mongo_client

    logger.info("Shutting down gracefully...")
    print("graceful_shutdown: Shutting down gracefully...", file=sys.stderr)  # Added print statement

    # Close MongoDB connection
    if global_mongo_client:
        logger.info("Closing MongoDB connection...")
        print("graceful_shutdown: Closing MongoDB connection...", file=sys.stderr)  # Added print statement
        global_mongo_client.close()

    logger.info("Shutdown complete")
    print("graceful_shutdown: Shutdown complete", file=sys.stderr)  # Added print statement
    sys.exit(0)

# Register signal handlers
signal.signal(signal.SIGINT, graceful_shutdown)
signal.signal(signal.SIGTERM, graceful_shutdown)

if __name__ == '__main__':
    # Initialize resources before starting the server
    initialize_resources()

    # Get port from environment or use default
    port = int(os.environ.get("PORT", 5001)) # changed to 5001

    # Start the server
    logger.info(f"Starting server on port {port}...")
    print(f"Starting server on port {port}...", file=sys.stderr)  # Added print statement
    app.run(host='0.0.0.0', port=port)