package com.banking.transaction.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;

@FeignClient(name = "account-service", url = "${ACCOUNT_SERVICE_URL:http://account-service:8083}/api/accounts")
public interface AccountClient {
    
    @PostMapping("/{accountNumber}/deduct")
    void deductBalance(@PathVariable String accountNumber, @RequestParam Double amount);

    @PostMapping("/{accountNumber}/credit")
    void creditBalance(@PathVariable String accountNumber, @RequestParam Double amount);

    @PostMapping("/transfer")
    org.springframework.http.ResponseEntity<String> transfer(@RequestParam String from, @RequestParam String to, @RequestParam Double amount);

    @org.springframework.web.bind.annotation.GetMapping
    java.util.List<com.banking.transaction.dto.AccountResponseDTO> getAccounts(@RequestHeader("X-User-UID") String uid);
}
