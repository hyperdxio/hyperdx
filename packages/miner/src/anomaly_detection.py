from typing import List, Optional, Dict, Any
import numpy as np
import ruptures as rpt
from sklearn.ensemble import IsolationForest
from pydantic import BaseModel
from scipy.stats import zscore
import copy

# strength is a measure of the sensitivity of the anomaly detection
# 0 would make the anomaly detection least sensitive (most likely to miss anoms)
# 1 would make it most sensitive (most likely to have false positives)
DEFAULT_STRENGTH = 0.5 # unused for now

DEFAULT_CONFIG = {
    "models": [
        {
            "name": "zscore",
            "enabled": True,
            "params": {
                "threshold": 3.0
            }
        },
        {
            "name": "change_point",
            "enabled": False,
            "params": {
                "penalty": 10
            }
        },
        {
            "name": "isolation_forest",
            "enabled": False,
            "params": {
                "contamination": 0.05
            }
        }
    ],
    "mode": "any"  # "combined" | "any"
    
    # TODO: still thinking here above - not important for MVP
    # Combined
    # Pros
    # - multiple methods being considered makes it more robust
    # - less likely to have false positives since they have to somewhat agree
    # - so less noisy
    # Cons
    # - easier to miss anoms if individual methods are off or thresholds are tweaked poorly
    # - so tuning is more important

    # Any
    # Pros
    # - much simpler to implement. understand, tweak etc 
    # - will catch pretty much all potential anoms - might be pro for display purposes but not alerting?
    # Cons
    # - way more likely to have false positives - any method would trigger vs a combo of all
    # - so more noisy - which might be a dealbreaker for alerting
    
}

class DataPoint(BaseModel):
    count: int
    ts_bucket: Optional[int] = None
    
class AnomalyResponse(BaseModel):
    is_anomalous: bool
    count: int
    ts_bucket: Optional[int] = None
    details: Dict[str, Dict[str, Any]]
    
class ZScoreResponse(BaseModel):
    is_anomalous: bool
    zscore: float
    mean: float
    threshold: float
    stdv: float

class ChangePointResponse(BaseModel):
    is_anomalous: bool
    penalty: float
    change_points: List[int]

class IsolationForestResponse(BaseModel):
    is_anomalous: bool
    isolation_score: float
    contamination: float

def calculate_zscore(history: List[DataPoint], params: Dict[str, Any], exclude_last: bool = False) -> List[ZScoreResponse]:
    # TODO: determine if this is valid for the detect_anomalies case.
    # technically each points is_anomalous calc should ignore itself (as if it was checked at the time it occurred)
    # but this adds some series perf cost and isn't viable for large sets as the mean/stdv would be recalculated for each point
    # this might be fine when ensembled and gets better the more data points you have but still worth considering....
    
    threshold = params.get('threshold', 3.0)
    counts = np.array([item.count for item in history[:-1]]) if exclude_last else np.array([item.count for item in history])
    zscores = zscore(counts)
    mean = np.mean(counts)
    stdv = np.std(counts)
    
    zscore_response = [ZScoreResponse(is_anomalous=False, zscore=0, mean=mean, threshold=threshold, stdv=stdv) for _ in range(len(history))]
    
    for i in range(len(history) - 1 if exclude_last else len(history)):
        if stdv != 0:
            zscore_response[i].zscore = abs(zscores[i])
        else:
            zscore_response[i].zscore = 0
        zscore_response[i].is_anomalous = bool(zscore_response[i].zscore > threshold)
    if exclude_last:
        if stdv != 0:
            zscore_response[-1].zscore = abs((history[-1].count - mean) / stdv)
        else:
            zscore_response[-1].zscore = 0
        zscore_response[-1].is_anomalous = bool(zscore_response[-1].zscore > threshold)
        
    return zscore_response

def detect_change_points(history: List[DataPoint], params: Dict[str, Any]) -> List[ChangePointResponse]:
    penalty = params.get('penalty', 10)
    counts = np.array([item.count for item in history]).reshape(-1, 1)
    model = rpt.Pelt(model="rbf").fit(counts)
    change_points = model.predict(pen=penalty)
    
    change_point_response = [ChangePointResponse(is_anomalous=False, penalty=penalty, change_points=change_points) for _ in range(len(history))]
    
    for i in range(len(history)):
        change_point_response[i].is_anomalous = i in change_points
    
    return change_point_response

def apply_isolation_forest(history: List[DataPoint], params: Dict[str, Any]) -> List[IsolationForestResponse]:
    contamination = params.get('contamination', 0.05)
    counts = np.array([item.count for item in history]).reshape(-1, 1)
    model = IsolationForest(contamination=contamination)
    preds = model.fit_predict(counts)
    scores = model.decision_function(counts)

    isolation_forest_response = [IsolationForestResponse(is_anomalous=False, isolation_score=0, contamination=contamination) for _ in range(len(history))]
    
    for i, (item, pred, score) in enumerate(zip(history, preds, scores)):
        isolation_forest_response[i].isolation_score = -score
        isolation_forest_response[i].is_anomalous = bool(pred == -1)

    return isolation_forest_response

def calculate_adjusted_params(strength: float) -> Dict[str, float]:
    return {
        "zscore_threshold": 5.0 - 4.0 * strength,
        "change_point_penalty": 10 * (1.0 - strength),
        "isolation_forest_contamination": max(0.1 * strength, 0.01)
    }
    
def merge_with_default_config(user_config: Dict[str, Any]) -> Dict[str, Any]:
    merged_config = copy.deepcopy(DEFAULT_CONFIG)
    user_models = {model['name']: model for model in user_config.get('models', [])}

    for model in merged_config['models']:
        if model['name'] in user_models:
            model.update(user_models[model['name']])

    if 'mode' in user_config:
        merged_config['mode'] = user_config['mode']

    return merged_config

def apply_ensemble_methods(history: List[DataPoint], strength: float, config: Dict[str, Any], exclude_last: bool = False) -> List[DataPoint]:
    config = merge_with_default_config(config)
    models = config['models']

    # params = calculate_adjusted_params(strength) # strength unused for the time being while we are using a very simple model
    
    enabled_methods = 0
    
    zscore_results = None
    change_point_results = None
    isolation_forest_results = None
    
    for model in models:
        if model.get('enabled', False):
            if model['name'] == 'zscore':
                zscore_results = calculate_zscore(history, model['params'], exclude_last)
            elif model['name'] == 'change_point':
                change_point_results = detect_change_points(history, model['params'])
            elif model['name'] == 'isolation_forest':
                isolation_forest_results = apply_isolation_forest(history, model['params'])
            enabled_methods += 1
    
    anomaly_response = [AnomalyResponse(is_anomalous=False, count=item.count, ts_bucket=item.ts_bucket, details={}) for item in history]

    if config.get('mode') == 'combined' and enabled_methods > 0:
        zscore_max = max([item.zscore for item in zscore_results], default=0) if zscore_results else 0
        isolation_max = max([item.isolation_score for item in isolation_forest_results], default=0) if isolation_forest_results else 0
        
        for i, item in enumerate(history):
            zscore_normalized = zscore_results[i].zscore / zscore_max if zscore_max else 0 if zscore_results else 0
            isolation_normalized = isolation_forest_results[i].isolation_score / isolation_max if isolation_max else 0 if isolation_forest_results else 0
            changepoint_anomalous = 1 if change_point_results and change_point_results[i].is_anomalous else 0
            combined_score_value = (zscore_normalized + isolation_normalized + changepoint_anomalous) / enabled_methods if enabled_methods else 0
            
            details = {}
            if zscore_results:
                details["zscore"] = zscore_results[i].dict()
            if change_point_results:
                details["changepoint"] = change_point_results[i].dict()
            if isolation_forest_results:
                details["isolation"] = isolation_forest_results[i].dict()
                
            anomaly_response[i].details.update(details)
            anomaly_response[i].is_anomalous = bool(combined_score_value > 0.5)
    
    elif config.get('mode') == 'any':
        for i, item in enumerate(history):
            is_anomalous = False
            details = {}
            if zscore_results:
                details["zscore"] = zscore_results[i].dict()
            if change_point_results:
                details["changepoint"] = change_point_results[i].dict()
            if isolation_forest_results:
                details["isolation"] = isolation_forest_results[i].dict()
                
            if zscore_results and zscore_results[i].is_anomalous or change_point_results and change_point_results[i].is_anomalous or isolation_forest_results and isolation_forest_results[i].is_anomalous:
                is_anomalous = True
                
            anomaly_response[i].is_anomalous = is_anomalous
            anomaly_response[i].details.update(details)
            
    return anomaly_response

def detect_anomalies(history: List[List[DataPoint]], strength: float, config: Dict[str, Any]) -> List[List[AnomalyResponse]]:
    results = []
    for series in history:
        results.append(apply_ensemble_methods(series, strength, config))
    return results

def detect_anomaly(history: List[DataPoint], current: DataPoint, strength: float, config: Dict[str, Any]) -> AnomalyResponse:
    history = history + [current]
    results = apply_ensemble_methods(history, strength, config, exclude_last=True)
    return results[-1]