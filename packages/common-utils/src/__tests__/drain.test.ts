import { TemplateMinerConfig } from '../drain/config';
import { Drain } from '../drain/drain';
import { TemplateMiner } from '../drain/template-miner';

describe('Drain', () => {
  it('test_add_shorter_than_depth_message', () => {
    const model = new Drain(4);
    let [cluster, changeType] = model.addLogMessage('hello');
    expect(changeType).toBe('cluster_created');

    [cluster, changeType] = model.addLogMessage('hello');
    expect(changeType).toBe('none');

    [cluster, changeType] = model.addLogMessage('otherword');
    expect(changeType).toBe('cluster_created');

    expect(model.clusterCount).toBe(2);
  });

  it('test_add_log_message', () => {
    const model = new Drain();
    const entries = `
Dec 10 07:07:38 LabSZ sshd[24206]: input_userauth_request: invalid user test9 [preauth]
Dec 10 07:08:28 LabSZ sshd[24208]: input_userauth_request: invalid user webmaster [preauth]
Dec 10 09:12:32 LabSZ sshd[24490]: Failed password for invalid user ftpuser from 0.0.0.0 port 62891 ssh2
Dec 10 09:12:35 LabSZ sshd[24492]: Failed password for invalid user pi from 0.0.0.0 port 49289 ssh2
Dec 10 09:12:44 LabSZ sshd[24501]: Failed password for invalid user ftpuser from 0.0.0.0 port 60836 ssh2
Dec 10 07:28:03 LabSZ sshd[24245]: input_userauth_request: invalid user pgadmin [preauth]`
      .split('\n')
      .filter(l => l.trim().length > 0);

    const expected = `
Dec 10 07:07:38 LabSZ sshd[24206]: input_userauth_request: invalid user test9 [preauth]
Dec 10 <*> LabSZ <*> input_userauth_request: invalid user <*> [preauth]
Dec 10 09:12:32 LabSZ sshd[24490]: Failed password for invalid user ftpuser from 0.0.0.0 port 62891 ssh2
Dec 10 <*> LabSZ <*> Failed password for invalid user <*> from 0.0.0.0 port <*> ssh2
Dec 10 <*> LabSZ <*> Failed password for invalid user <*> from 0.0.0.0 port <*> ssh2
Dec 10 <*> LabSZ <*> input_userauth_request: invalid user <*> [preauth]`
      .split('\n')
      .filter(l => l.trim().length > 0)
      .map(l => l.trim());

    const actual: string[] = [];
    for (const entry of entries) {
      const [cluster] = model.addLogMessage(entry);
      actual.push(cluster.getTemplate());
    }

    expect(actual).toEqual(expected);
    // Python test reports 8 because splitlines() includes 2 empty entries from triple-quote;
    // we only feed the 6 real log lines, so total is 6.
    expect(model.getTotalClusterSize()).toBe(6);
  });

  it('test_add_log_message_sim_75', () => {
    const model = new Drain(4, 0.75, 100);
    const entries = `
Dec 10 07:07:38 LabSZ sshd[24206]: input_userauth_request: invalid user test9 [preauth]
Dec 10 07:08:28 LabSZ sshd[24208]: input_userauth_request: invalid user webmaster [preauth]
Dec 10 09:12:32 LabSZ sshd[24490]: Failed password for invalid user ftpuser from 0.0.0.0 port 62891 ssh2
Dec 10 09:12:35 LabSZ sshd[24492]: Failed password for invalid user pi from 0.0.0.0 port 49289 ssh2
Dec 10 09:12:44 LabSZ sshd[24501]: Failed password for invalid user ftpuser from 0.0.0.0 port 60836 ssh2
Dec 10 07:28:03 LabSZ sshd[24245]: input_userauth_request: invalid user pgadmin [preauth]`
      .split('\n')
      .filter(l => l.trim().length > 0);

    const expected = `
Dec 10 07:07:38 LabSZ sshd[24206]: input_userauth_request: invalid user test9 [preauth]
Dec 10 07:08:28 LabSZ sshd[24208]: input_userauth_request: invalid user webmaster [preauth]
Dec 10 09:12:32 LabSZ sshd[24490]: Failed password for invalid user ftpuser from 0.0.0.0 port 62891 ssh2
Dec 10 <*> LabSZ <*> Failed password for invalid user <*> from 0.0.0.0 port <*> ssh2
Dec 10 <*> LabSZ <*> Failed password for invalid user <*> from 0.0.0.0 port <*> ssh2
Dec 10 07:28:03 LabSZ sshd[24245]: input_userauth_request: invalid user pgadmin [preauth]`
      .split('\n')
      .filter(l => l.trim().length > 0)
      .map(l => l.trim());

    const actual: string[] = [];
    for (const entry of entries) {
      const [cluster] = model.addLogMessage(entry);
      actual.push(cluster.getTemplate());
    }

    expect(actual).toEqual(expected);
    expect(model.getTotalClusterSize()).toBe(6);
  });

  it('test_max_clusters', () => {
    const model = new Drain(4, 0.4, 100, 1);
    const entries = `
A format 1
A format 2
B format 1
B format 2
A format 3`
      .split('\n')
      .filter(l => l.trim().length > 0);

    const expected = [
      'A format 1',
      'A format <*>',
      'B format 1',
      'B format <*>',
      'A format 3',
    ];

    const actual: string[] = [];
    for (const entry of entries) {
      const [cluster] = model.addLogMessage(entry);
      actual.push(cluster.getTemplate());
    }

    expect(actual).toEqual(expected);
    expect(model.getTotalClusterSize()).toBe(1);
  });

  it('test_max_clusters_lru_multiple_leaf_nodes', () => {
    const model = new Drain(4, 0.4, 100, 2, [], '*');
    const entries = [
      'A A A',
      'A A B',
      'B A A',
      'B A B',
      'C A A',
      'C A B',
      'B A A',
      'A A A',
    ];
    const expected = [
      'A A A',
      'A A *',
      'B A A',
      'B A *',
      'C A A',
      'C A *',
      'B A *',
      'A A A',
    ];

    const actual: string[] = [];
    for (const entry of entries) {
      const [cluster] = model.addLogMessage(entry);
      actual.push(cluster.getTemplate());
    }

    expect(actual).toEqual(expected);
    expect(model.getTotalClusterSize()).toBe(4);
  });

  it('test_max_clusters_lru_single_leaf_node', () => {
    const model = new Drain(4, 0.4, 100, 2, [], '*');
    const entries = [
      'A A A',
      'A A B',
      'A B A',
      'A B B',
      'A C A',
      'A C B',
      'A B A',
      'A A A',
    ];
    const expected = [
      'A A A',
      'A A *',
      'A B A',
      'A B *',
      'A C A',
      'A C *',
      'A B *',
      'A A A',
    ];

    const actual: string[] = [];
    for (const entry of entries) {
      const [cluster] = model.addLogMessage(entry);
      actual.push(cluster.getTemplate());
    }

    expect(actual).toEqual(expected);
  });

  it('test_match_only', () => {
    const model = new Drain();
    model.addLogMessage('aa aa aa');
    model.addLogMessage('aa aa bb');
    model.addLogMessage('aa aa cc');
    model.addLogMessage('xx yy zz');

    let c = model.match('aa aa tt');
    expect(c).not.toBeNull();
    expect(c!.clusterId).toBe(1);

    c = model.match('xx yy zz');
    expect(c).not.toBeNull();
    expect(c!.clusterId).toBe(2);

    c = model.match('xx yy rr');
    expect(c).toBeNull();

    c = model.match('nothing');
    expect(c).toBeNull();
  });

  it('test_create_template', () => {
    const model = new Drain(4, 0.4, 100, null, [], '*');

    const seq1 = ['aa', 'bb', 'dd'];
    const seq2 = ['aa', 'bb', 'cc'];

    let template = model.createTemplate(seq1, seq2);
    expect(template).toEqual(['aa', 'bb', '*']);

    template = model.createTemplate(seq1, seq1);
    expect(template).toEqual(seq1);

    expect(() => model.createTemplate(seq1, ['aa'])).toThrow();
  });
});

describe('TemplateMiner', () => {
  it('add_log_message with masking', () => {
    const config = new TemplateMinerConfig();
    config.maskingInstructions = [
      {
        pattern:
          '((?<=[^A-Za-z0-9])|^)(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})((?=[^A-Za-z0-9])|$)',
        maskWith: 'IP',
      },
      {
        pattern: '((?<=[^A-Za-z0-9])|^)([\\-\\+]?\\d+)((?=[^A-Za-z0-9])|$)',
        maskWith: 'NUM',
      },
    ];
    config.maskPrefix = '<:';
    config.maskSuffix = ':>';

    const miner = new TemplateMiner(config);

    let result = miner.addLogMessage('connected to 10.0.0.1');
    expect(result.changeType).toBe('cluster_created');
    expect(result.clusterId).toBe(1);
    expect(result.templateMined).toContain('<:IP:>');

    result = miner.addLogMessage('connected to 192.168.0.1');
    expect(result.changeType).toBe('none');
    expect(result.clusterId).toBe(1);
  });

  it('match after training', () => {
    const config = new TemplateMinerConfig();
    const miner = new TemplateMiner(config);

    miner.addLogMessage('user alice logged in');
    miner.addLogMessage('user bob logged in');

    const matched = miner.match('user charlie logged in');
    expect(matched).not.toBeNull();
    expect(matched!.clusterId).toBe(1);

    const noMatch = miner.match('something completely different');
    expect(noMatch).toBeNull();
  });

  it('extract_parameters', () => {
    const config = new TemplateMinerConfig();
    config.maskingInstructions = [
      {
        pattern: '((?<=[^A-Za-z0-9])|^)([\\-\\+]?\\d+)((?=[^A-Za-z0-9])|$)',
        maskWith: 'NUM',
      },
    ];
    const miner = new TemplateMiner(config);

    miner.addLogMessage('user johndoe logged in 11 minutes ago');
    miner.addLogMessage('user janedoe logged in 5 minutes ago');

    const result = miner.addLogMessage('user bob logged in 3 minutes ago');
    const params = miner.extractParameters(
      result.templateMined,
      'user bob logged in 3 minutes ago',
      false,
    );

    expect(params).not.toBeNull();
    expect(params!.length).toBeGreaterThan(0);
  });
});
