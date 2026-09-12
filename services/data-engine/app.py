"""Stateless HTTP boundary; CPU work runs in FastAPI's worker thread pool."""
import asyncio
import threading
from fastapi import FastAPI, HTTPException
from starlette.responses import JSONResponse
from analytics import analyze
from models import AnalyzeRequest
from collectors import router
from web_crawler import router as crawler_router

MAX_REQUEST_BYTES = 48 * 1024 * 1024

class BoundedBody:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope.get('method') != 'POST':
            return await self.app(scope, receive, send)
        parts, total = [], 0
        try:
            async with asyncio.timeout(15):
                while True:
                    message = await receive()
                    if message['type'] == 'http.disconnect':
                        return
                    body = message.get('body', b'')
                    total += len(body)
                    if total > MAX_REQUEST_BYTES:
                        return await JSONResponse({'detail': 'request exceeds 48 MiB'}, status_code=413)(scope, receive, send)
                    parts.append(body)
                    if not message.get('more_body', False):
                        break
        except TimeoutError:
            return await JSONResponse({'detail': 'request body timed out'}, status_code=408)(scope, receive, send)
        payload = b''.join(parts)
        delivered = False
        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': payload, 'more_body': False}
            return await receive()
        await self.app(scope, replay, send)

app = FastAPI(title='Radar data engine', version='1', docs_url=None, redoc_url=None)
app.add_middleware(BoundedBody)
app.include_router(router)
app.include_router(crawler_router)
analysis_lock = threading.Lock()

@app.get('/health')
def health():
    return {'status': 'ok', 'version': '1'}

@app.post('/analyze')
def analyze_documents(request: AnalyzeRequest):
    if not analysis_lock.acquire(blocking=False):
        raise HTTPException(status_code=503, detail='analysis busy; retry later')
    try:
        return analyze(request)
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    finally:
        analysis_lock.release()
