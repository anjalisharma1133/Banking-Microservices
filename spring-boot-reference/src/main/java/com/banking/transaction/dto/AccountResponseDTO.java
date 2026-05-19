package com.banking.transaction.dto;

import lombok.Data;

@Data
public class AccountResponseDTO {
    private String id;
    private String accountNumber;
    private String ownerUid;
}
