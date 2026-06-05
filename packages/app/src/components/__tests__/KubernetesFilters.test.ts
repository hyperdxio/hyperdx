import { stripFieldClause } from '../KubernetesFilters';

describe('stripFieldClause', () => {
  const resourceAttr = 'ResourceAttributes';

  it('removes only the target field clause, keeping other filters and free text', () => {
    const query =
      'ResourceAttributes.k8s.cluster.name:"prod" ResourceAttributes.k8s.namespace.name:"api" error';

    // Building the faceted `where` for the namespace dropdown drops the
    // namespace clause but keeps the cluster selection and free-text search,
    // so the namespace options are narrowed to the selected cluster.
    expect(stripFieldClause(query, resourceAttr, 'k8s.namespace.name')).toBe(
      'ResourceAttributes.k8s.cluster.name:"prod" error',
    );
  });

  it('returns an empty string when the query only contains the target clause', () => {
    expect(
      stripFieldClause(
        'ResourceAttributes.k8s.cluster.name:"prod"',
        resourceAttr,
        'k8s.cluster.name',
      ),
    ).toBe('');
  });

  it('leaves the query unchanged when the target field is absent', () => {
    const query = 'ResourceAttributes.k8s.cluster.name:"prod"';
    expect(stripFieldClause(query, resourceAttr, 'k8s.namespace.name')).toBe(
      query,
    );
  });

  it('does not strip a sibling field that shares a path prefix', () => {
    // `k8s.pod.name` must not match `k8s.pod.uid`.
    const query =
      'ResourceAttributes.k8s.pod.name:"a" ResourceAttributes.k8s.pod.uid:"b"';
    expect(stripFieldClause(query, resourceAttr, 'k8s.pod.name')).toBe(
      'ResourceAttributes.k8s.pod.uid:"b"',
    );
  });
});
