# Quant Comp 2026

Independent projects for trading competitions. Each game keeps its own source code, tests, data and documentation.

| Project | Folder | Status |
| --- | --- | --- |
| HRT AlgoArena stock/news prediction | [algoarena](algoarena/) | Existing research and source |
| Scavenger | [scavenger](scavenger/) | **Live decision panel available** |
| Baskets | [baskets](baskets/) | **Live decision panel available in GitHub** |
| Vault | [vault](vault/) | Ready for development |
| Treasures & Trash | [treasures-and-trash](treasures-and-trash/) | Ready for development |
| Liar's Market | [liars-market](liars-market/) | **Live decision panel available in GitHub** |

The five Waterloo Quant Club games are from the Fall 2026 Trading Competition packet. AlgoArena is the separate existing HRT project.

## Running the competition panels locally

```bash
python -m http.server 8000
```

Open `http://localhost:8000/` to select a game. Scavenger is at `/scavenger/`; Baskets is at `/baskets/`; Liar's Market is at `/liars-market/`. Each runs without a backend or AI API, and saves observations in the local browser. Run `cd baskets && npm test` or `cd liars-market && npm test` to validate the corresponding panel.

**Production deployments are paused:** Vercel is configured not to deploy Git pushes. The deployed public URL may still serve the earlier Scavenger-only version. Ask explicitly before publishing new changes.

## Running AlgoArena

```bash
cd algoarena
python -m pip install -r requirements.txt
python -m pytest -q
python make_submission.py
```

The submission CSV is saved in `algoarena/predictions.csv`, and research reports in `algoarena/runs/`. Both are excluded from new Git commits. See [AlgoArena documentation](algoarena/README.md).

## Adding a game

Keep each game's source, tests, datasets, dependencies and instructions in its own folder. Avoid creating game-specific code at the repository root. Shared GitHub Actions workflows live under `.github/workflows/`.
