import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiErrorMessage } from '@/lib/api';
import {
  catalogApi,
  type CatalogItem,
  type FormField,
} from '@/lib/serviceApi';

const ItemDialog = ({ item, onClose, onSaved }: {
  item: CatalogItem | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [icon] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [active, setActive] = useState(true);
  const [departments] = useState<string[]>([]);
  const [locations] = useState<string[]>([]);
  const [roles] = useState<string[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  const [error, setError] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    try {
      const updatedItem = {
        ...item,
        name,
        description: description || undefined,
        category: category || undefined,
        icon: icon || undefined,
        sortOrder: sortOrder || 0,
        active: active ? true : false,
        eligibility: {
          departments: departments,
          locations: locations,
          roles: roles,
        },
        formSchema: [...fields],
      };
      if (item?.id) {
        await catalogApi.update(item.id, updatedItem);
      } else {
        await catalogApi.create(updatedItem);
      }
      onSaved(`Service "${name}" saved`);
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, 'Save failed'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 p-4">
      <div className="max-w-lg w-full rounded border p-5 bg-card">
        <h2 className="text-base font-semibold mb-3">
          {item ? 'Edit Service' : 'Create Service'}
        </h2>
        <form onSubmit={handleSave}>
          {error && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border rounded p-2"
            />
          </div>

          <div className="space-y-2">
            <label className="flex flex-col text-sm">
              Category
            </label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border rounded p-2"
            />
          </div>

          <div className="space-y-2">
            <label className="flex flex-col text-sm">
              Sort order
            </label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              className="w-full border rounded p-2"
            />
          </div>

          <div className="space-y-2">
            <label className="flex flex-col text-sm">
              Active?
            </label>
            <div className="flex items-center">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 mr-1" />
              <span>{active ? 'Yes' : 'Hidden'}</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex flex-col text-sm">
              Fields
            </label>
            <div className="overflow-y-auto h-40 space-y-1">
              {fields.map((field, i) => (
                <div key={i} className="flex items-center gap-2 mb-1">
                  <span className="text-sm text-gray-700 mr-2">{field.name}</span>
                  <input
                    type="text"
                    value={field.name}
                    onChange={(e) => setFields(prev => {
                      const updated = [...prev];
                      updated[i] = { ...field, name: e.target.value };
                      return updated;
                    })}
                    className="w-full border rounded p-2"
                  />
                </div>
              ))}
            </div>
          </div>

          <button type="submit" className="bg-primary text-white px-3 py-1 rounded">
            Save
          </button>
          <button type="button" onClick={onClose} className="ml-2 bg-gray-300 text-gray-500 px-3 py-1 rounded">
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
};

const RuleDialog = ({
  item,
  onClose,
  onSaved,
}: {
  item: CatalogItem | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) => {
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (item) {
      setName(item.approvalRule?.name ?? '');
      setSteps(item.approvalRule?.steps ?? []);
    }
  }, [item]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    try {
      await catalogApi.saveRule(item!.id, {
        name: name.trim(),
        steps: steps.map(s => ({
          ...s,
          name: s.name.trim(),
        })),
      });
      onSaved(`Rule ${name} saved`);
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, 'Save failed'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 p-4">
      <div className="max-w-lg w-full bg-card border rounded p-5">
        <h3 className="text-base font-medium mb-3">{item ? 'Edit' : 'Create'} Rule</h3>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="space-y-2">
            <label className="block text-sm">
              Rule name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border p-2 rounded"
            />
          </div>
          {error && <p role="alert" className="text-red-600">{error}</p>}
          <button type="submit" className="mt-2 bg-primary text-white px-3 py-1 rounded">
            Save
          </button>
          <button type="button" onClick={onClose} className="ml-2 text-gray-500">
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
};

export default function CatalogAdminPage() {
  const { data: items, isLoading } = useQuery({
    queryKey: ['catalog-items'],
    queryFn: () => catalogApi.list(),
  });
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [ruleFor, setRuleFor] = useState<CatalogItem | null>(null);
  const [, setNotice] = useState('');

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-3">Catalog Administration</h1>
      <button onClick={() => setCreating(true)} className="bg-primary text-white px-3 py-1 mb-2">
        New Service
      </button>
      <div className="mt-6">
        {isLoading ? (
          <div className="text-gray-500">Loading...</div>
        ) : (
          items?.map((item) => (
            <div key={item.id} className="border rounded p-3 mb-2">
              <div className="flex justify-between">
                <span className="font-medium">{item.name}</span>
                <span>{item.active ? 'Active' : 'Hidden'}</span>
              </div>
              <div className="flex gap-2 mt-2">
                <button onClick={() => setEditing(item)} className="text-blue-500 hover:underline">
                  Edit
                </button>
                <button onClick={() => setRuleFor(item)} className="text-blue-500 hover:underline">
                  Edit Rule
                </button>
              </div>
            </div>
          ))
        )}

        {creating && (
          <ItemDialog
            item={null}
            onClose={() => setCreating(false)}
            onSaved={(msg) => setNotice(msg)}
          />
        )}

        {editing && (
          <ItemDialog
            item={editing}
            onClose={() => setEditing(null)}
            onSaved={(msg) => { setNotice(msg); }}
          />
        )}

        {ruleFor && (
          <RuleDialog
            item={ruleFor}
            onClose={() => setRuleFor(null)}
            onSaved={(msg) => {
              setNotice(msg);
            }}
          />
        )}
      </div>
    </div>
  );
}