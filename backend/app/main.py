from fastapi import FastAPI

from app.routers import jobs

app = FastAPI(title="SEO/AEO/GEO Analysis Backend", version="0.1.0")
app.include_router(jobs.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
