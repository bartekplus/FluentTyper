const TEMPALTE_VARIABLES = {
  time: () => {
    return new Date().toLocaleTimeString();
  },
  date: () => {
    return new Date().toLocaleDateString();
  },
};

export { TEMPALTE_VARIABLES };
