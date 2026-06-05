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

  it('treats dots in the attribute as literal characters, not regex wildcards', () => {
    // Unescaped, the dots would act as wildcards and wrongly strip this clause
    // where the path separators are different characters. Escaping keeps them
    // literal, so a non-dotted lookalike is left untouched.
    const query = 'ResourceAttributesXk8sXpodXname:"a"';
    expect(stripFieldClause(query, resourceAttr, 'k8s.pod.name')).toBe(query);
  });

  it('does not throw when the resource attribute contains regex metacharacters', () => {
    // An unescaped `(` would produce an "unterminated group" SyntaxError.
    expect(() =>
      stripFieldClause('foo', 'attr(', 'k8s.pod.name'),
    ).not.toThrow();
    expect(stripFieldClause('foo', 'attr(', 'k8s.pod.name')).toBe('foo');
  });
});
