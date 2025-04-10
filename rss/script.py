import feedparser
from pymongo import MongoClient
import os
from sentence_transformers import SentenceTransformer
import schedule
import time
import datetime
import logging  # Import logging
import atexit

# Configure logging
logging.basicConfig(
    level=logging.INFO,  # Or logging.DEBUG for more verbose output
    format='%(asctime)s - %(levelname)s - %(message)s',
    filename='rss_fetcher.log',  # Log to a file
    filemode='a'  # Append to the log file
)

model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

# Environment variables for secure configuration
MONGODB_URI = os.environ.get("MONGODB_URI")
DATABASE_NAME = os.environ.get("DATABASE_NAME", "newsDB")
COLLECTION_NAME = os.environ.get("COLLECTION_NAME", "news_articles")

if not MONGODB_URI:
    logging.error("MONGODB_URI environment variable not set. Exiting.")
    import sys
    sys.exit(1)  # Exit with an error code
else:
    logging.info(f"Using MongoDB URI: {MONGODB_URI}")

def read_feed_urls_from_file(file_path="rss.txt"):
    """Read RSS feed URLs from a text file."""
    try:
        with open(file_path, 'r') as file:
            urls = [line.strip() for line in file if line.strip()]

        if not urls:
            logging.warning(f"No URLs found in {file_path}")

        return urls
    except FileNotFoundError:
        logging.error(f"RSS feed file not found at {file_path}")
        return []
    except Exception as e:
        logging.exception("Error reading RSS feed URLs from file")
        return []

# Read RSS feed URLs from file
RSS_FEED_URLS = read_feed_urls_from_file()

# Fallback to default URLs if file reading fails
if not RSS_FEED_URLS:
    logging.info("Using default RSS feed URLs...")
    RSS_FEED_URLS = [
        "http://feeds.bbci.co.uk/news/rss.xml",  # Example BBC News
        "http://rss.cnn.com/rss/edition.rss"     # Example CNN
    ]

def fetch_and_parse_feeds(feed_urls):
    """Fetches and parses RSS feeds from a list of URLs."""
    articles = []
    for url in feed_urls:
        try:
            feed = feedparser.parse(url)
            if feed.bozo == 1:  # Check for parsing errors
                logging.error(f"Error parsing feed from {url}: {feed.bozo_exception}")
                continue  # Skip to the next feed

            for entry in feed.entries:
                title = entry.get("title", "No Title")
                description = entry.get("description", "No Description")
                text_to_encode = f"{title}. {description}"  # Combine title and description

                try:
                    vector = model.encode(text_to_encode).tolist()
                except Exception as e:
                    logging.error(f"Error encoding: {e}")
                    continue  # Skip the entry if encoding fails

                article = {
                    "title": entry.get("title", "No Title"),
                    "link": entry.get("link", None),
                    "description": entry.get("summary", ""),  # Use summary if available
                    "published": entry.get("published", entry.get("updated", "")),  # Store date as string
                    "vector": vector
                }
                articles.append(article)
        except Exception as e:
            logging.exception(f"Error processing feed from {url}")

    return articles

def store_articles_in_mongodb(articles, mongodb_uri, database_name, collection_name):
    """Stores articles in MongoDB, removing existing documents first."""
    try:
        client = MongoClient(mongodb_uri)
        db = client[database_name]
        collection = db[collection_name]

        # Remove all existing documents from the collection
        logging.info(f"Removing all existing documents from collection: {collection_name}")
        result = collection.delete_many({})  # Delete all documents
        logging.info(f"Deleted {result.deleted_count} documents.")

        if not articles:
            logging.info("No articles to store.")
            return

        collection.insert_many(articles)  # Insert the new articles
        logging.info(f"Successfully stored {len(articles)} articles in MongoDB.")

    except Exception as e:
        logging.exception("Error storing articles in MongoDB")
    finally:
        if "client" in locals():  # Ensure client gets closed even if error happens
            client.close()

def job():
    """Function to be run on schedule"""
    current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    logging.info(f"Running scheduled job to fetch RSS feeds...")  # Log instead of print
    articles = fetch_and_parse_feeds(RSS_FEED_URLS)
    if articles:
        store_articles_in_mongodb(articles, MONGODB_URI, DATABASE_NAME, COLLECTION_NAME)
    else:
        logging.info("No articles fetched.")

# Ensure graceful shutdown
def graceful_exit():
    logging.info("Exiting RSS feed fetcher...")

# Register the exit handler
atexit.register(graceful_exit)


from flask import Flask, jsonify

app = Flask(__name__)

@app.route('/run-now', methods=['GET'])
def run_now():
    job()
    return jsonify({"status": "done", "message": "Job executed!"})

if __name__ == "__main__":
    import threading

    def scheduler_loop():
        schedule.every(15).minutes.do(job)
        job()  # run once at startup
        while True:
            schedule.run_pending()
            time.sleep(1)

    # Run the schedule loop in a thread
    thread = threading.Thread(target=scheduler_loop, daemon=True)
    thread.start()

    # Start Flask server
    app.run(host="0.0.0.0", port=5000)
