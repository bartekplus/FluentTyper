class PresageCallback {
  constructor() {
    this.predictions = [];
  }

  getPredictions() {
    return this.predictions;
  }

  implement() {
    return this.getPredictions.bind(this);
  }
}

class NativePredictions {
  constructor(predictions) {
    this.predictions = predictions;
  }

  size() {
    return this.predictions.length;
  }
  get(idx) {
    return { prediction: this.predictions[idx], probability: 1.0 / idx };
  }
}

class FakeLibPresage {
  constructor(getPredictions, xmlPath) {
    this.xmlPath = xmlPath;
    this.getPredictions = getPredictions;
  }
  predictWithProbability() {
    return new NativePredictions(this.getPredictions());
  }
  config() {}
}

class Module {
  constructor() {
    this.Presage = FakeLibPresage;
    this.PresageCallback = new PresageCallback();
  }
}
const mod = new Module();
export { mod };
