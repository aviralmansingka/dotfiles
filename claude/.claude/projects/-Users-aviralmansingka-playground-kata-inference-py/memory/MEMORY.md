# kata-inference-py

## Architecture
Hexagonal architecture with domain, ports, and adapters layers.

## Project Structure
```
src/kata_inference_py/
    __main__.py              # python -m entry point
    main.py                  # composition root (wires adapters + use case)
    domain/
        models/
            value.py         # Tagged Value subclasses (IntValue, FloatValue, StrValue, *ListValue)
            inference.py     # InferenceRequest, InferenceResult
            __init__.py      # re-exports all models
        use_case.py          # PredictUseCase
    ports/
        driven.py            # ModelRunner protocol
        driving.py           # PredictPort protocol
    adapters/
        xgboost_runner.py    # XGBoostRunner - feature assembly + prediction
        http_server.py       # FastAPI app factory (depends on PredictPort)
        http_models.py       # Pydantic discriminated union for JSON deserialization
tests/
    conftest.py              # session-scoped model generation fixtures
    booster_factory.py       # creates XGBoost Booster with deterministic seed
    test_predict.py          # use case delegation test
    test_acceptance.py       # end-to-end HTTP acceptance test
    adapters/
        test_xgboost_runner.py  # feature assembly + run method tests
```

## Key Design Decisions
- Value types use tagged dataclasses (not union alias) for unambiguous runtime discrimination
- Protocols are structural (no explicit inheritance needed)
- Pydantic models live in adapter layer with `to_domain()` conversion
- Features assembled in sorted key order for consistency
- DMatrix receives 2D input: `xgb.DMatrix([features])`

## User Preferences
- Wants guidance and review, not full solutions written for them (learning mode)
- Uses uv for package management
- Build system: uv_build
