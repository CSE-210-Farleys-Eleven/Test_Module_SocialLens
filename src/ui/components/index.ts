import type { CreateComponents } from './contract';
import { createChart } from './chart';
import { createDom } from './dom';
import { formatMetricValue } from './format';
import { createMetric } from './metric';
import { createMisc } from './misc';
import { createTable } from './table';

export const createComponents: CreateComponents = ({ document, glossary }) => {
  const dom = createDom(document);
  const metric = createMetric(dom.h, glossary);
  const { dataTable } = createTable(dom.h);
  const { barChart } = createChart(document, dom.h, dataTable);
  const misc = createMisc(dom.h, dom.button);
  return { ...dom, ...metric, dataTable, barChart, ...misc };
};

export { formatMetricValue };
