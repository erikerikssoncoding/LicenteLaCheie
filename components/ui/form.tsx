import * as React from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import { cn } from "@/lib/utils";

const Form = <TFieldValues extends FieldValues = FieldValues>({
  className,
  ...props
}: React.FormHTMLAttributes<HTMLFormElement>) => {
  return <form className={cn("space-y-6", className)} {...props} />;
};
Form.displayName = "Form";

interface FormFieldContextValue {
  name: string;
}

const FormFieldContext = React.createContext<FormFieldContextValue | undefined>(
  undefined
);

const useFormField = () => {
  const context = React.useContext(FormFieldContext);
  if (!context) {
    throw new Error("useFormField should be used within <FormField>");
  }
  return context;
};

interface FormFieldProps<TFieldValues extends FieldValues = FieldValues>
  extends React.HTMLAttributes<HTMLDivElement> {
  name: keyof TFieldValues & string;
  control?: UseFormReturn<TFieldValues>["control"];
}

const FormField = <TFieldValues extends FieldValues = FieldValues>(
  { name, children, className }: React.PropsWithChildren<FormFieldProps<TFieldValues>>
) => {
  return (
    <FormFieldContext.Provider value={{ name }}>
      <div className={cn("space-y-2", className)}>{children}</div>
    </FormFieldContext.Provider>
  );
};
FormField.displayName = "FormField";

const FormLabel = ({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label
    className={cn("text-sm font-medium text-slate-700", className)}
    {...props}
  />
);
FormLabel.displayName = "FormLabel";

const FormControl = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("space-y-2", className)} {...props} />
);
FormControl.displayName = "FormControl";

const FormMessage = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => {
  const { name } = useFormField();
  if (!children) {
    return null;
  }
  return (
    <p
      className={cn("text-sm font-medium text-red-600", className)}
      role="alert"
      {...props}
    >
      {children}
    </p>
  );
};
FormMessage.displayName = "FormMessage";

const FormDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-sm text-slate-500", className)} {...props} />
);
FormDescription.displayName = "FormDescription";

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormLabel,
  FormMessage,
  useFormField
};
