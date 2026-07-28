export type DeepPartial<T> = {
  [Key in keyof T]?: T[Key] extends string
    ? string
    : T[Key] extends object
      ? DeepPartial<T[Key]>
      : T[Key];
};
