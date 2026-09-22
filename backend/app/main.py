from fastapi import FastAPI

from app.routers import batches, jobs, notion

app = FastAPI(title="SEO/AEO/GEO Analysis Backend", version="0.1.0")
app.include_router(jobs.router)
app.include_router(batches.router)
app.include_router(notion.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
