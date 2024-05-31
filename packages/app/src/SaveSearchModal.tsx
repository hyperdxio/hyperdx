import { FormEvent, useEffect, useState } from 'react';
import { Form, Modal } from 'react-bootstrap';
import { Button as Button, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import api from './api';
import { genEnglishExplanation } from './queryv2';

export default function SaveSearchModal({
  onHide,
  searchQuery,
  mode,
  searchName,
  searchID,
  onSaveSuccess,
  onUpdateSuccess,
}: {
  onHide: () => void;
  searchQuery: string;
  mode: 'save' | 'update' | 'hidden';
  searchName: string;
  searchID: string;
  onSaveSuccess: (responseData: { _id: string }) => void;
  onUpdateSuccess: (responseData: { _id: string }) => void;
}) {
  const saveLogView = api.useSaveLogView();
  const updateLogView = api.useUpdateLogView();

  const [parsedEnglishQuery, setParsedEnglishQuery] = useState<string>('');

  useEffect(() => {
    genEnglishExplanation(searchQuery).then(q => {
      setParsedEnglishQuery(q);
    });
  }, [searchQuery]);

  const onSubmitLogView = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const target = e.target as typeof e.target & {
      name: { value: string };
    };
    // TODO: fallback to parsedEnglishQuery for better UX ??
    const name = target.name.value || parsedEnglishQuery;

    if (mode === 'update') {
      updateLogView.mutate(
        {
          id: searchID,
          name,
          query: searchQuery,
        },
        {
          onSuccess: response => {
            onUpdateSuccess(response.data);
          },
          onError: () => {
            notifications.show({
              color: 'red',
              message:
                'An error occured. Please contact support for more details.',
            });
          },
        },
      );
    } else {
      saveLogView.mutate(
        {
          name,
          query: searchQuery,
        },
        {
          onSuccess: response => {
            onSaveSuccess(response.data);
          },
          onError: () => {
            notifications.show({
              color: 'red',
              message:
                'An error occured. Please contact support for more details.',
            });
          },
        },
      );
    }
  };

  return (
    <Modal
      aria-labelledby="contained-modal-title-vcenter"
      centered
      onHide={onHide}
      show={mode !== 'hidden'}
      size="lg"
    >
      <Modal.Body className="bg-grey rounded">
        <h5 className="text-muted">Save Search</h5>
        <Form onSubmit={onSubmitLogView}>
          <Form.Group className="mb-3 mt-4">
            <Text span fw="bold">
              Query:
            </Text>
            <Text span> {searchQuery}</Text>
          </Form.Group>
          <Form.Group className="mb-2 mt-2">
            <Form.Label className="text-start text-muted fs-7">Name</Form.Label>
            <Form.Control
              className="border-0 mb-4 px-3"
              id="name"
              name="name"
              placeholder={parsedEnglishQuery}
              size="sm"
              type="text"
              autoFocus
              defaultValue={searchName}
            />
          </Form.Group>
          <Button size="sm" variant="light" type="submit">
            {mode === 'update' ? 'Update' : 'Save'}
          </Button>
        </Form>
      </Modal.Body>
    </Modal>
  );
}
