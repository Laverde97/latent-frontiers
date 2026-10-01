"""Ejemplo mínimo de LTC con la librería ncps (PyTorch).

Requiere:  pip install ncps torch
"""

import torch
from ncps.torch import LTC

torch.manual_seed(0)

rnn = LTC(input_size=7, units=32, batch_first=True, ode_unfolds=6)

sequence = torch.randn(16, 32, 7)  # (batch, T, M)
outputs, last_state = rnn(sequence)

print("salidas:", tuple(outputs.shape))          # (16, 32, 32)
print("estado final:", tuple(last_state.shape))  # (16, 32)

outputs.sum().backward()

# Recuento de parámetros entrenables, por tensor (para compararlo con la implementación manual)
counts = {name.split(".")[-1]: p.numel() for name, p in rnn.named_parameters() if p.requires_grad}
for name, n in counts.items():
    print(f"  {name:14s} {n:5d}")
print("parámetros entrenables:", sum(counts.values()))
