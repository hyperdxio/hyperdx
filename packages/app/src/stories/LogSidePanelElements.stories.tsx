import { Table } from '../components/Table';
import { MOCK_BREADCRUMBS } from './LogSidePanelElements.mocks';
import { SectionWrapper, breadcrumbColumns } from '../LogSidePanelElements';

export const Breadcrumbs = () => {
  return (
    <SectionWrapper>
      <Table
        columns={breadcrumbColumns}
        data={MOCK_BREADCRUMBS}
        emptyMessage="No breadcrumbs found"
      />
    </SectionWrapper>
  );
};

export default {
  title: 'LogSidePanelElements',
};
