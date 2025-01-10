import logging
import os

def get_logging_level():
    try:
        return getattr(logging, os.environ.get("HYPERDX_LOG_LEVEL", "DEBUG").upper())
    except Exception:
        return logging.DEBUG


logger = logging.getLogger(__name__)
logger.setLevel(get_logging_level())