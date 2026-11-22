# Quant Comp 2026

Independent projects for trading competitions. Each game keeps its own source code, tests, data and documentation.

| Project | Folder | Status |
| --- | --- | --- |
| HRT AlgoArena stock/news prediction | [algoarena](algoarena/) | Existing research and source |
| Scavenger | [scavenger](scavenger/) | **Live decision panel available** |
| Baskets | [baskets](baskets/) | Ready for development |
| Vault | [vault](vault/) | Ready for development |
| Treasures & Trash | [treasures-and-trash](treasures-and-trash/) | Ready for development |
| Liar's Market | [liars-market](liars-market/) | Ready for development |

The five Waterloo Quant Club games are from the Fall 2026 Trading Competition packet. AlgoArena is the separate existing HRT project.

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
